/**
 * Escape from the block menu keeps the block selected, like Notion (U109,
 * U142, U161). Deleting a sub-page block shows a "Moved to Trash" toast whose
 * Restore undoes the delete (U108, U109).
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
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

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

const savedBlock = async (page: Page, id: string): Promise<SavedBlock | undefined> => page.evaluate(async (blockId) => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  return (await window.blokInstance.save()).blocks.find((block) => block.id === blockId);
}, id);

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

const tableBlocks = (): SavedBlock[] => {
  const cols = ['colA', 'colB'];
  const kids: SavedBlock[] = [];
  const content = ['row1', 'row2'].map((rowId, r) => cols.map((colId, c) => {
    const id = `c${r}${c}`;

    kids.push({ id, type: 'paragraph', data: { text: `${'AB'[c]}${r + 1}` }, parent: 'tbl' });

    return { blocks: [id], id: colId, rowId };
  }));

  return [
    P('p-before', 'before'),
    { id: 'tbl', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content }, content: kids.map(k => k.id ?? '') },
    ...kids,
  ];
};

const PAGE_BLOCKS: SavedBlock[] = [P('p1', 'Alpha'), { id: 'sub', type: 'page', data: { pageId: 'child-page' } }, P('p3', 'Gamma')];

test.describe('Escape from the block menu keeps the block selected (V3)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U109: handle menu, Escape: the block stays selected with no caret, and Backspace deletes it as one undo step', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p2').click();
    await gap(page);
    await openTunes(page, 'p2');

    await page.keyboard.press('Escape');
    await expect(page.locator(TUNES_POPOVER)).toBeHidden();
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['p2']);
    expect(await hasCaret(page)).toBe(false);

    await page.keyboard.press('Backspace');
    await expect.poll(() => ids(page)).toEqual(['p1', 'p3']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(['p1', 'p2', 'p3']);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
  });

  // Blok's Header row closes the menu, so this covers U161's Escape on the table menu itself.
  test('U161: Escape from the table menu keeps the table selected', async ({ page }) => {
    await createBlok(page, tableBlocks());
    await editable(page, 'p-before').click();
    await gap(page);
    await openTunes(page, 'tbl');

    await page.keyboard.press('Escape');
    await expect(page.locator(TUNES_POPOVER)).toBeHidden();
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['tbl']);
    expect(await hasCaret(page)).toBe(false);
  });

  test('Escape from a submenu closes only the submenu, and the block stays selected', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p2').click();
    await gap(page);
    await openTunes(page, 'p2');
    await tune(page, 'convert-to').click();
    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(NESTED_POPOVER)).toBeHidden();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(TUNES_POPOVER)).toBeHidden();
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['p2']);
  });

  test('a click outside the menu still lets the selection go', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p2').click();
    await gap(page);
    await openTunes(page, 'p2');

    await editable(page, 'p3').click();
    await expect(page.locator(TUNES_POPOVER)).toBeHidden();
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual([]);
  });
});

test.describe('deleting a sub-page block shows a Trash toast (V14)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U108: Backspace on a selected page block shows "Moved to Trash"; Restore brings it back with its id and data', async ({ page }) => {
    await createBlok(page, PAGE_BLOCKS);
    const before = await savedBlock(page, 'sub');

    await editable(page, 'p1').click();
    await gap(page);
    await openTunes(page, 'sub');
    await page.keyboard.press('Escape');
    await gap(page, 300);
    expect(await selectedIds(page)).toEqual(['sub']);

    await page.keyboard.press('Backspace');
    await expect.poll(() => ids(page)).toEqual(['p1', 'p3']);
    const toast = trashToast(page);

    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Restore' }).click();

    await expect.poll(() => ids(page)).toEqual(['p1', 'sub', 'p3']);
    expect(await savedBlock(page, 'sub')).toEqual(before);
    await expect(toast).toBeHidden();
    await gap(page, 300);

    // Restore is an undo: redo trashes it again.
    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['p1', 'p3']);
  });

  test('Move to Trash in the page block menu shows the toast too', async ({ page }) => {
    await createBlok(page, PAGE_BLOCKS);
    await editable(page, 'p1').click();
    await gap(page);
    await openTunes(page, 'sub');
    await tune(page, 'delete').click();
    await expect.poll(() => ids(page)).toEqual(['p1', 'p3']);
    const toast = trashToast(page);

    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => ids(page)).toEqual(['p1', 'sub', 'p3']);
  });

  test('deleting a paragraph shows no Trash toast', async ({ page }) => {
    await createBlok(page, PAGE_BLOCKS);
    await editable(page, 'p3').click();
    await gap(page);
    await openTunes(page, 'p3');
    await tune(page, 'delete').click();
    await expect.poll(() => ids(page)).toEqual(['p1', 'sub']);
    await gap(page, 500);
    await expect(trashToast(page)).toHaveCount(0);
  });
});
