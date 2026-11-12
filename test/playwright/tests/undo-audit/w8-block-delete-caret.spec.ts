/**
 * A block-selection delete leaves no caret, and neither does its redo, however
 * the block was selected (Notion U108, U109, U142). Restore on the Trash toast
 * says "Undone" like an undo press (U109). Deleting the block that undo gave
 * back, then undoing, loses nothing (U104). Two drags undo one at a time (U112).
 */
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE_GAP = 800;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];

const createBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await page.evaluate(async ({ holder, initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
};

const gap = async (page: Page, ms = CAPTURE_GAP): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

const ids = async (page: Page): Promise<string[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  return (await window.blokInstance.save()).blocks.filter((block) => block.parent === undefined).map((block) => block.id ?? '');
});

const selectedIds = async (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"][data-blok-selected="true"]'))
    .map(el => el.getAttribute('data-blok-id') ?? ''));

const hasCaret = async (page: Page): Promise<boolean> => page.evaluate((holder) => {
  const root = document.getElementById(holder);
  const selection = window.getSelection();
  const active = document.activeElement;
  const rangeInside = selection !== null && selection.rangeCount > 0 && root !== null && root.contains(selection.anchorNode);
  const editableFocused = active instanceof HTMLElement && active.isContentEditable;

  return rangeInside || editableFocused;
}, HOLDER_ID);

/**
 * True when focus or the selection sits in a block, so a typed key would edit
 * it. Chrome leaves a collapsed range in the redactor, between blocks, when
 * the focused block is deleted; nothing can be typed there.
 */
const caretInBlock = async (page: Page): Promise<boolean> => page.evaluate(() => {
  const selection = window.getSelection();
  const anchor = selection !== null && selection.rangeCount > 0 ? selection.anchorNode : null;
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
  const active = document.activeElement;

  return anchorElement?.closest('[data-blok-id]') != null || (active instanceof HTMLElement && active.closest('[data-blok-id]') !== null);
});

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Hover the block until its handle shows, click it, and wait for its menu. */
const openTunes = async (page: Page, id: string): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  const points = [[0.5, 0.5], [0.1, 0.1], [0.5, 0.05], [0.9, 0.5]];

  for (const [fx, fy] of points) {
    await page.mouse.move(box.x + box.width * fx, box.y + Math.min(box.height * fy, box.height - 2));
    const handle = page.locator(HANDLE);

    if (!(await handle.isVisible())) {
      continue;
    }
    await handle.click();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    if (await page.locator(`[data-blok-id="${id}"][data-blok-selected="true"]`).count() > 0) {
      return;
    }
    await page.keyboard.press('Escape');
    await gap(page, 200);
  }
  throw new Error(`could not open the block menu for ${id}`);
};

const tune = (page: Page, name: string): Locator =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

const trashToast = (page: Page): Locator => page.getByTestId('notification').filter({ hasText: 'Moved to Trash' });

const P = (id: string, text: string): SavedBlock => ({ id, type: 'paragraph', data: { text } });

const BASE = [P('p1', 'Alpha'), P('p2', 'Beta'), P('p3', 'Gamma')];

const PAGE_BLOCKS: SavedBlock[] = [P('p1', 'Alpha'), { id: 'sub', type: 'page', data: { pageId: 'child-page' } }, P('p3', 'Gamma')];

const COLUMNS: SavedBlock[] = [
  { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['l1'] },
  { id: 'l1', type: 'paragraph', data: { text: 'left' }, parent: 'c1' },
  { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['r1'] },
  { id: 'r1', type: 'paragraph', data: { text: 'right' }, parent: 'c2' },
];

/** Put the caret at the end of block `id`, the way the scenarios start. */
const caretAtEnd = async (page: Page, id: string): Promise<void> => {
  await editable(page, id).click();
  await page.keyboard.press('End');
  await gap(page);
};

/** Saved top-level blocks as `id:text`, and the same read from the DOM, in order. */
const savedVsDom = async (page: Page): Promise<{ saved: string[]; dom: string[] }> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }
  const blocks = (await window.blokInstance.save()).blocks;
  // Rich text saves as segments.
  const saved = blocks.map((block) => {
    const segments = (block.data as { text?: Array<{ text: string }> }).text ?? [];

    return `${block.id ?? ''}:${segments.map((segment) => segment.text).join('')}`;
  });
  const dom = Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"]')).map((holder) => {
    const id = holder.getAttribute('data-blok-id') ?? '';

    return `${id}:${holder.querySelector('[contenteditable]')?.textContent ?? ''}`;
  });

  return { saved, dom };
});

const expectSavedMatchesDom = async (page: Page, expected: string[]): Promise<void> => {
  await expect.poll(async () => (await savedVsDom(page)).saved).toEqual(expected);
  expect((await savedVsDom(page)).dom).toEqual(expected);
};

const dragTo = async (page: Page, id: string, targetId: string, edge: 'top' | 'bottom'): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const handle = await page.locator(HANDLE).boundingBox();
  const target = await page.locator(`[data-blok-id="${targetId}"] [data-blok-element-content]`).first().boundingBox();

  if (handle === null || target === null) {
    throw new Error('missing boxes for drag');
  }
  const y = edge === 'top' ? target.y + 2 : target.y + target.height - 2;

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(target.x + target.width / 2, handle.y + (y - handle.y) * i / 8);
  }
  await page.mouse.up();
};

test.describe('a block-selection delete leaves no caret (W1)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  const deleteAndRedo = async (page: Page, before: string[], after: string[], key = 'Backspace'): Promise<void> => {
    await page.keyboard.press(key);
    await expect.poll(() => ids(page)).toEqual(after);
    await gap(page, 300);
    expect(await caretInBlock(page)).toBe(false);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(before);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(after);
    await gap(page, 300);
    expect(await caretInBlock(page)).toBe(false);
  };

  test('handle menu, Escape, Backspace: no caret in the block clicked before, after the delete or the redo', async ({ page }) => {
    await createBlok(page, BASE);
    await caretAtEnd(page, 'p1');
    await openTunes(page, 'p2');
    await page.keyboard.press('Escape');
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['p2']);

    await deleteAndRedo(page, ['p1', 'p2', 'p3'], ['p1', 'p3']);
  });

  test('handle menu, Escape, Delete: no caret after the delete or the redo', async ({ page }) => {
    await createBlok(page, BASE);
    await caretAtEnd(page, 'p1');
    await openTunes(page, 'p2');
    await page.keyboard.press('Escape');
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['p2']);

    await deleteAndRedo(page, ['p1', 'p2', 'p3'], ['p1', 'p3'], 'Delete');
  });

  test('Escape from a caret, Backspace: no caret after the delete or the redo', async ({ page }) => {
    await createBlok(page, BASE);
    await caretAtEnd(page, 'p1');
    await caretAtEnd(page, 'p2');
    await page.keyboard.press('Escape');
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['p2']);

    await deleteAndRedo(page, ['p1', 'p2', 'p3'], ['p1', 'p3']);
  });

  test('Shift+ArrowDown from a caret, Backspace: no caret after the delete or the redo', async ({ page }) => {
    await createBlok(page, [...BASE, P('p4', 'Delta')]);
    await caretAtEnd(page, 'p1');
    await caretAtEnd(page, 'p2');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => selectedIds(page)).toEqual(['p2', 'p3']);

    await deleteAndRedo(page, ['p1', 'p2', 'p3', 'p4'], ['p1', 'p4']);
  });

  test('U108: a sub-page block deleted from the menu selection leaves no caret in the text above', async ({ page }) => {
    await createBlok(page, PAGE_BLOCKS);
    await caretAtEnd(page, 'p1');
    await openTunes(page, 'sub');
    await page.keyboard.press('Escape');
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['sub']);

    await deleteAndRedo(page, ['p1', 'sub', 'p3'], ['p1', 'p3']);
  });

  test('U142: emptying a column from the menu selection leaves no caret in the other column', async ({ page }) => {
    await createBlok(page, COLUMNS);
    await caretAtEnd(page, 'l1');
    await openTunes(page, 'r1');
    await page.keyboard.press('Escape');
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['r1']);

    await page.keyboard.press('Backspace');
    await expect.poll(() => ids(page)).toEqual(['l1']);
    await gap(page, 300);
    expect(await caretInBlock(page)).toBe(false);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(['cl']);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['l1']);
    await gap(page, 300);
    expect(await caretInBlock(page)).toBe(false);
  });
});

test.describe('the Trash toast Restore speaks like undo (W8)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U109: Restore puts "Undone" in the live region', async ({ page }) => {
    await createBlok(page, PAGE_BLOCKS);
    await caretAtEnd(page, 'p1');
    await openTunes(page, 'sub');
    await page.keyboard.press('Escape');
    await gap(page, 300);
    await page.keyboard.press('Backspace');
    const toast = trashToast(page);

    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Restore' }).click();

    await expect.poll(() => ids(page)).toEqual(['p1', 'sub', 'p3']);
    await expect(page.locator('[data-blok-announcer][role="status"]')).toHaveText('Undone');
    await gap(page, 300);

    // Notion leaves no caret after the redo either.
    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['p1', 'p3']);
    await gap(page, 300);
    expect(await caretInBlock(page)).toBe(false);
  });
});

test.describe('deleting the block undo gave back loses nothing (U104)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('menu Delete, undo, Backspace, undo: the block comes back each time, one press per step', async ({ page }) => {
    const all = ['p1:Alpha', 'p2:Beta', 'p3:Gamma'];
    const without = ['p1:Alpha', 'p3:Gamma'];

    await createBlok(page, BASE);
    await caretAtEnd(page, 'p2');
    await openTunes(page, 'p2');
    await tune(page, 'delete').click();
    await expectSavedMatchesDom(page, without);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expectSavedMatchesDom(page, all);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    await gap(page);

    await page.keyboard.press('Backspace');
    await expectSavedMatchesDom(page, without);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expectSavedMatchesDom(page, all);
    await gap(page, 300);

    // Both deletes are undone: nothing older is left to undo.
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
  });
});

test.describe('two drags undo one at a time (U112)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  // Notion's order: drag 1 puts "three" first, drag 2 moves "one" to the bottom.
  test('drag "three" above "one", drag "one" to the bottom, undo twice, redo twice', async ({ page }) => {
    await createBlok(page, [P('b1', 'one'), P('b2', 'two'), P('b3', 'three')]);
    await caretAtEnd(page, 'b1');

    await dragTo(page, 'b3', 'b1', 'top');
    await expect.poll(() => ids(page)).toEqual(['b3', 'b1', 'b2']);
    await gap(page);
    // Blok keeps the handle on the selected "three" while "one" is hovered, so drag 2 starts from a caret in "one".
    await editable(page, 'b1').click();
    await gap(page);
    await dragTo(page, 'b1', 'b2', 'bottom');
    await expect.poll(() => ids(page)).toEqual(['b3', 'b2', 'b1']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(['b3', 'b1', 'b2']);
    await expect.poll(() => selectedIds(page)).toEqual(['b1']);
    expect(await hasCaret(page)).toBe(false);
    await gap(page, 300);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(['b1', 'b2', 'b3']);
    await expect.poll(() => selectedIds(page)).toEqual(['b3']);
    expect(await hasCaret(page)).toBe(false);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['b3', 'b1', 'b2']);
    // Notion leaves "one" selected here too, not "three", the block drag 1 moved.
    await expect.poll(() => selectedIds(page)).toEqual(['b1']);
    expect(await hasCaret(page)).toBe(false);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['b3', 'b2', 'b1']);
    await expect.poll(() => selectedIds(page)).toEqual(['b1']);
    expect(await hasCaret(page)).toBe(false);
  });
});
