/**
 * Undo/redo audit, wave 10: the block menu's "Move to" (Notion U110).
 *
 * Notion: Move to opens a page picker with search; the pick takes the block
 * off this page, and one undo brings it back with the same id. Here the
 * pages Blok can move into are database rows whose body is their child
 * blocks in this document.
 */
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const MENU = process.platform === 'darwin' ? 'Meta+/' : 'Control+/';
const CAPTURE_GAP = 800;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];

const database = (rows: string[]): SavedBlock => ({
  id: 'db-1',
  type: 'database',
  data: {
    title: 'Tasks',
    schema: [
      { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
      { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' }] } },
    ],
    views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] }],
    activeViewId: 'view-1',
  },
  content: rows,
});

const DOC: SavedBlock[] = [
  { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
  { id: 'tg', type: 'toggle', data: { text: 'Move me' }, content: ['tg-kid'] },
  { id: 'tg-kid', type: 'paragraph', parent: 'tg', data: { text: 'kid' } },
  { id: 'p-a', type: 'paragraph', data: { text: 'alpha' } },
  { id: 'p-b', type: 'paragraph', data: { text: 'beta' } },
  { id: 'p-after', type: 'paragraph', data: { text: 'after' } },
  database(['row-1', 'row-2', 'row-far']),
  { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', title: 'Card one', properties: { 'prop-title': 'Card one', 'prop-status': 'opt-todo' } }, content: ['row-1-body'] },
  { id: 'row-1-body', type: 'paragraph', parent: 'row-1', data: { text: 'Body text' } },
  { id: 'row-2', type: 'database-row', parent: 'db-1', data: { position: 'a1', title: 'Card two', properties: { 'prop-title': 'Card two', 'prop-status': 'opt-todo' } } },
  // Its page body lives in another document, which this editor cannot write.
  { id: 'row-far', type: 'database-row', parent: 'db-1', data: { position: 'a2', title: 'Card far', pageId: 'page-far', properties: { 'prop-title': 'Card far', 'prop-status': 'opt-todo' } } },
];

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

const save = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

const gap = async (page: Page, ms = CAPTURE_GAP): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

/** Each block holder's id and the id of the block holder around it. */
const domParents = async (page: Page): Promise<Record<string, string>> => page.evaluate((holder) => {
  const root = document.getElementById(holder);

  return Object.fromEntries(Array.from(root?.querySelectorAll('[data-blok-testid="block-wrapper"]') ?? []).map(el => [
    el.getAttribute('data-blok-id') ?? '',
    el.parentElement?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id') ?? 'root',
  ]));
}, HOLDER_ID);

/** save()'s parent for each block, in the shape of {@link domParents}. */
const savedParents = (blocks: SavedBlock[]): Record<string, string> =>
  Object.fromEntries(blocks.map(block => [block.id ?? '', block.parent ?? 'root']));

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await gap(page, 500);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await gap(page, 500);
};

const openTunes = async (page: Page, id: string): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  await page.mouse.move(box.x + box.width * 0.5, box.y + 4);
  await page.locator(HANDLE).click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();
};

const moveToItem = (page: Page): Locator =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="move-to"]`);

const pickerRows = (page: Page): Locator => page.getByRole('listbox', { name: 'Move to' }).getByRole('option');

const DRAWER_EDITOR = '[data-blok-database-drawer-editor]';

/** Opens a row's page in the side drawer. */
const openCard = async (page: Page, rowId: string): Promise<void> => {
  await page.locator(`[data-blok-database-card][data-row-id="${rowId}"] [data-blok-database-card-title]`).click();
  await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
  await gap(page, 1200);
};

const closeCard = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-database-drawer-close]').click();
  await gap(page, 1200);
};

const contentOf = (blocks: SavedBlock[], id: string): string[] | undefined => blocks.find(block => block.id === id)?.content;

test.describe.configure({ retries: 0 });

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('W10 Move to', () => {
  test('W10-1: moves a toggle with its child into a row page; one undo brings both back, redo moves them again', async ({ page }) => {
    await createBlok(page, DOC);
    await gap(page);
    const before = await save(page);

    await openTunes(page, 'tg');
    await moveToItem(page).click();
    await expect(page.getByTestId('page-picker-search-input')).toBeFocused();
    // Rows whose body lives in another document are not offered.
    await expect(pickerRows(page)).toHaveText([/Card one/, /Card two/]);
    await page.keyboard.type('two');
    await expect(pickerRows(page)).toHaveText([/Card two/]);
    await page.keyboard.press('Enter');
    await gap(page);

    const after = await save(page);

    expect(after.find(block => block.id === 'tg')?.parent).toBe('row-2');
    expect(after.find(block => block.id === 'tg-kid')?.parent).toBe('tg');
    expect(contentOf(after, 'row-2')).toEqual(['tg']);
    expect(after.map(block => block.id).sort()).toEqual(before.map(block => block.id).sort());
    expect(await domParents(page)).toMatchObject(savedParents(after));
    await expect(page.locator(`[data-blok-id="tg"]`)).toBeHidden();
    // The moved blocks show on the row's page.
    await openCard(page, 'row-2');
    await expect(page.locator(DRAWER_EDITOR).getByText('Move me', { exact: true })).toBeVisible();
    // A toggle opens closed, so its child is there but folded.
    await expect(page.locator(`${DRAWER_EDITOR} [data-blok-id="tg"] [data-blok-id="tg-kid"]`)).toHaveText('kid');
    await closeCard(page);

    await editable(page, 'p-after').click();
    await undo(page);
    expect(await save(page)).toEqual(before);
    expect(await domParents(page)).toMatchObject(savedParents(before));
    await expect(page.locator(`[data-blok-id="tg"]`)).toBeVisible();
    await openCard(page, 'row-2');
    await expect(page.locator(DRAWER_EDITOR).getByText('Move me', { exact: true })).toHaveCount(0);
    await closeCard(page);

    await redo(page);
    expect(await save(page)).toEqual(after);
    expect(await domParents(page)).toMatchObject(savedParents(after));
  });

  test('W10-2: moves a two-block selection to the end of a row page in order, as one undo step', async ({ page }) => {
    await createBlok(page, DOC);
    await gap(page);
    const before = await save(page);

    await editable(page, 'p-a').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(2);
    await page.keyboard.press(MENU);
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    await moveToItem(page).click();
    await pickerRows(page).filter({ hasText: 'Card one' }).click();
    await gap(page);

    const after = await save(page);

    expect(contentOf(after, 'row-1')).toEqual(['row-1-body', 'p-a', 'p-b']);
    expect(await domParents(page)).toMatchObject(savedParents(after));

    await editable(page, 'p-after').click();
    await undo(page);
    expect(await save(page)).toEqual(before);
    expect(await domParents(page)).toMatchObject(savedParents(before));

    await redo(page);
    expect(await save(page)).toEqual(after);
  });

  test('W10-3: Escape closes the picker and changes nothing', async ({ page }) => {
    await createBlok(page, DOC);
    await gap(page);
    const before = await save(page);

    await openTunes(page, 'p-a');
    await moveToItem(page).click();
    await expect(pickerRows(page)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('page-picker-search-input')).toHaveCount(0);
    expect(await save(page)).toEqual(before);
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo() ?? false)).toBe(false);
  });

  test('W10-4: no row this editor can write means no Move to item', async ({ page }) => {
    await createBlok(page, DOC.filter(block => block.id !== 'row-1' && block.id !== 'row-1-body' && block.id !== 'row-2')
      .map(block => (block.id === 'db-1' ? database(['row-far']) : block)));
    await gap(page);
    await openTunes(page, 'p-a');
    await expect(page.locator(`${TUNES_POPOVER} [data-blok-item-name="duplicate"]`)).toBeVisible();
    await expect(moveToItem(page)).toHaveCount(0);
  });
});
