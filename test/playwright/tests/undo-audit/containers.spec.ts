/**
 * Undo/redo audit, container layer (CON): where undo/redo leaves a container
 * with the wrong structure, lost or phantom children, or a view that no longer
 * matches the saved model.
 *
 * Expected behaviour everywhere: undo must restore the exact prior state, and
 * redo the exact post-gesture state — in save() AND in the live DOM.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;
const SETTINGS_BUTTON = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];
type LiveBlock = { id: string; name: string; parentId: string | null };

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const save = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  // lastEdited* is authorship metadata, not document state.
  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

const gap = async (page: Page, ms = CAPTURE_GAP): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

/** Every block the editor holds, with its live parent. */
const liveBlocks = async (page: Page): Promise<LiveBlock[]> => page.evaluate(() => {
  const api = window.blokInstance?.blocks;

  if (api === undefined) {
    return [];
  }
  const out: LiveBlock[] = [];

  for (let i = 0; i < api.getBlocksCount(); i++) {
    const b = api.getBlockByIndex(i);

    if (b !== undefined) {
      out.push({ id: b.id, name: b.name, parentId: b.parentId ?? null });
    }
  }

  return out;
});

/** Each rendered block and the id of the block holder that encloses it in the DOM. */
const domTree = async (page: Page): Promise<Array<[string, string | null]>> => page.evaluate((holder) => {
  const root = document.getElementById(holder);

  return root === null
    ? []
    : Array.from(root.querySelectorAll('[data-blok-testid="block-wrapper"]')).map(el => [
      el.getAttribute('data-blok-id') ?? '',
      el.parentElement?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id') ?? null,
    ] as [string, string | null]);
}, HOLDER_ID);

/** Undo with the caret parked in a plain paragraph outside the container. */
const undo = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p-before"] [contenteditable="true"]').click();
  await page.keyboard.press(UNDO_SHORTCUT);
  await gap(page, 500);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO_SHORTCUT);
  await gap(page, 500);
};

const tableCellTexts = async (page: Page): Promise<string[][]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-table-row]')).map(row =>
    Array.from(row.querySelectorAll(':scope > [data-blok-table-cell]')).map(c => (c.textContent ?? '').trim())
  ));

const tableData = async (page: Page): Promise<Record<string, unknown>> =>
  (await save(page)).find(b => b.type === 'table')?.data ?? {};

const cell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`);

const openRowGrip = async (page: Page, row: number): Promise<void> => {
  await cell(page, row, 0).click();
  const grip = page.locator(`[data-blok-table-grip-row="${row}"]`);

  await expect(grip).toBeVisible();
  await grip.click();
};

const openColGrip = async (page: Page, col: number): Promise<void> => {
  await cell(page, 0, col).click();
  const grip = page.locator(`[data-blok-table-grip-col="${col}"]`);

  await expect(grip).toBeVisible();
  await grip.click();
};

const openTunesFor = async (page: Page, blockId: string): Promise<void> => {
  const editable = page.locator(`[data-blok-id="${blockId}"] [contenteditable="true"]`).first();

  await editable.click();
  await editable.hover();
  await page.locator(SETTINGS_BUTTON).click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();
};

const tune = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

const dragBy = async (page: Page, locator: ReturnType<Page['locator']>, dx: number, dy: number): Promise<void> => {
  const box = await locator.boundingBox();

  if (box === null) {
    throw new Error('drag handle has no box');
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
};

/** A table as the current version saves it: cell blocks plus row and column ids. */
const TABLE_DOC: OutputData = (() => {
  const cols = ['colA', 'colB'];
  const rows = ['row1', 'row2', 'row3'];
  const kids: SavedBlock[] = [];
  const content = rows.map((rowId, r) => cols.map((colId, c) => {
    const id = `c${r}${c}`;

    kids.push({ id, type: 'paragraph', data: { text: `${'AB'[c]}${r + 1}` }, parent: 'tbl' });

    return { blocks: [id], id: colId, rowId };
  }));

  return {
    blocks: [
      { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
      { id: 'tbl', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content }, content: kids.map(k => k.id ?? '') },
      ...kids,
      { id: 'p-after', type: 'paragraph', data: { text: 'after' } },
    ],
  };
})();

const COLUMNS_DOC: OutputData = {
  blocks: [
    { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1a', 'p1b'] },
    { id: 'p1a', type: 'paragraph', data: { text: 'Left top' }, parent: 'c1' },
    { id: 'p1b', type: 'paragraph', data: { text: 'Left bottom' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
    { id: 'p-after', type: 'paragraph', data: { text: 'after' } },
  ],
};

const kidsDoc = (container: 'toggle' | 'callout'): OutputData => ({
  blocks: [
    { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
    container === 'toggle'
      ? { id: 'box', type: 'toggle', data: { text: 'Box title', isOpen: true }, content: ['k1', 'k2'] }
      : { id: 'box', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
    { id: 'k1', type: 'paragraph', data: { text: 'kid one' }, parent: 'box' },
    { id: 'k2', type: 'paragraph', data: { text: 'kid two' }, parent: 'box' },
    { id: 'p-after', type: 'paragraph', data: { text: 'after' } },
  ],
});

const DB_DOC: OutputData = {
  blocks: [
    { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
    {
      id: 'db-1',
      type: 'database',
      data: {
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          {
            id: 'prop-status',
            name: 'Status',
            type: 'select',
            position: 'a1',
            config: {
              options: [
                { id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' },
                { id: 'opt-done', label: 'Done', color: 'green', position: 'a1' },
              ],
            },
          },
        ],
        views: [
          { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
        ],
        activeViewId: 'view-1',
      },
      content: ['row-1', 'row-2'],
    },
    { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'prop-title': 'Card one', 'prop-status': 'opt-todo' } } },
    { id: 'row-2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'prop-title': 'Card two', 'prop-status': 'opt-done' } } },
    { id: 'p-after', type: 'paragraph', data: { text: 'after' } },
  ],
};

/** Card ids and titles the board shows, per column, in DOM order. */
const boardCards = async (page: Page): Promise<string[][]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-database-column]')).map(col =>
    Array.from(col.querySelectorAll('[data-blok-database-card]')).map(c =>
      `${c.getAttribute('data-row-id') ?? ''}:${(c.querySelector('[data-blok-database-card-title]')?.textContent ?? '').trim()}`)));

test.describe.configure({ retries: 0 });

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('CON table', () => {
  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-1 undo of a row delete brings the row back with its cell content', async ({ page }) => {
    test.fail();
    // Observed: row 2 after one undo is ['', ''] — fresh empty cell blocks; c10/c11 come back only on a
    // SECOND undo, into cell [0][1] ("B1A2B2"), and the empties stay. Same via history.undo().
    await createBlok(page, TABLE_DOC);
    const before = await save(page);

    await gap(page);
    await openRowGrip(page, 1);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await gap(page);
    await expect.poll(async () => (await tableCellTexts(page)).length).toBe(2);

    await undo(page);

    expect((await tableCellTexts(page))[1], 'row 2 cell texts after one undo').toEqual(['A2', 'B2']);
    expect(await save(page)).toEqual(before);
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-2 undo of a column delete brings the column back with its cell content', async ({ page }) => {
    test.fail();
    // Observed: column A after one undo is ['', '', ''] — fresh empty cell blocks, not c00/c10/c20.
    await createBlok(page, TABLE_DOC);
    const before = await save(page);

    await gap(page);
    await openColGrip(page, 0);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await gap(page);
    await expect.poll(async () => (await tableCellTexts(page))[0].length).toBe(1);

    await undo(page);

    expect((await tableCellTexts(page)).map(row => row[0]), 'column A texts after one undo').toEqual(['A1', 'A2', 'A3']);
    expect(await save(page)).toEqual(before);
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-3 undo of the first column resize restores the default widths', async ({ page }) => {
    test.fail();
    // Observed: colWidths after undo is still [430, 350] in save() and in the DOM, while the undo step is
    // consumed. Undoing a SECOND resize works, so only the absent-key case fails.
    await createBlok(page, TABLE_DOC);
    await gap(page);
    await dragBy(page, page.locator('[data-blok-table-resize]').first(), 80, 0);
    await gap(page);
    expect((await tableData(page)).colWidths).toBeDefined();

    await undo(page);

    expect((await tableData(page)).colWidths, 'colWidths after undo').toBeUndefined();
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-4 undo of the first text size change restores compact text', async ({ page }) => {
    test.fail();
    // Observed: textSize after undo is still 'comfortable' (same absent-key shape as CON-3).
    await createBlok(page, TABLE_DOC);
    await gap(page);
    await cell(page, 0, 0).click();
    await page.locator(SETTINGS_BUTTON).click();
    await page.getByText('Text size', { exact: true }).hover();
    await page.getByText('Comfortable text', { exact: true }).click();
    await page.keyboard.press('Escape');
    await gap(page);
    expect((await tableData(page)).textSize).toBe('comfortable');

    await undo(page);

    expect((await tableData(page)).textSize, 'textSize after undo').toBeUndefined();
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-5 undo of a row insert leaves no phantom cell blocks in the editor', async ({ page }) => {
    test.fail();
    // Observed: the new row's two paragraphs stay alive in BlockManager with parentId 'tbl' after undo —
    // not in the DOM, not in save(). Same for the add-row button.
    await createBlok(page, TABLE_DOC);
    const liveBefore = await liveBlocks(page);

    await gap(page);
    await openRowGrip(page, 0);
    await page.getByRole('menuitem', { name: 'Insert row below', exact: true }).click();
    await gap(page);
    await expect.poll(async () => (await tableCellTexts(page)).length).toBe(4);

    await undo(page);

    const phantoms = (await liveBlocks(page)).filter(b => !liveBefore.some(x => x.id === b.id));

    expect(phantoms, 'blocks alive after undo that did not exist before').toEqual([]);
  });

  test('table: move column by drag, undo and redo keep ids, order and DOM', async ({ page }) => {
    await createBlok(page, TABLE_DOC);
    const before = await save(page);

    await gap(page);
    await cell(page, 0, 0).click();
    const grip = page.locator('[data-blok-table-grip-col="0"]');

    await expect(grip).toBeVisible();
    const target = await cell(page, 0, 1).boundingBox();
    const g = await grip.boundingBox();

    if (target === null || g === null) {
      throw new Error('no box');
    }
    await dragBy(page, grip, target.x + target.width + 10 - (g.x + g.width / 2), 0);
    await gap(page);
    const after = await save(page);

    expect((await tableCellTexts(page))[0]).toEqual(['B1', 'A1']);

    await undo(page);
    expect(await save(page)).toEqual(before);
    expect((await tableCellTexts(page))[0]).toEqual(['A1', 'B1']);

    await redo(page);
    expect(await save(page)).toEqual(after);
    expect((await tableCellTexts(page))[0]).toEqual(['B1', 'A1']);
  });
});

test.describe('CON columns', () => {
  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-6 undo of a column resize keeps the column layout', async ({ page }) => {
    test.fail();
    // Observed: one undo deletes cl1, c1 and c2 and lifts p1a/p1b/p2 to the top level; canRedo is then
    // false. Same with widthRatio already set, and via history.undo().
    await createBlok(page, COLUMNS_DOC);
    await gap(page);
    await dragBy(page, page.getByTestId('column-resizer').first(), 100, 0);
    await gap(page);
    const resized = await save(page);

    expect(resized.find(b => b.id === 'c1')?.data.widthRatio).toBeDefined();

    await undo(page);

    expect((await save(page)).map(b => b.id), 'block ids after undo').toEqual(['p-before', 'cl1', 'c1', 'p1a', 'p1b', 'c2', 'p2', 'p-after']);
    expect(await domTree(page)).toContainEqual(['p1a', 'c1']);
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-7 one undo of the unwrap after emptying a column restores the two-column layout', async ({ page }) => {
    test.fail();
    // Observed: undo 1 leaves an EMPTY column_list next to top-level p1a/p1b; it takes 4 undos
    // (cl1, then c1, then c2, then p2) to get back to the original layout.
    await createBlok(page, COLUMNS_DOC);
    const before = await save(page);

    await gap(page);
    await openTunesFor(page, 'p2');
    await tune(page, 'delete').click();
    await gap(page);
    expect((await save(page)).map(b => b.id)).toEqual(['p-before', 'p1a', 'p1b', 'p-after']);

    await undo(page);

    expect(await domTree(page), 'DOM tree after one undo').toEqual([
      ['p-before', null], ['cl1', null], ['c1', 'cl1'], ['p1a', 'c1'], ['p1b', 'c1'], ['c2', 'cl1'], ['p2', 'c2'], ['p-after', null],
    ]);
    expect(await save(page)).toEqual(before);
  });
});

test.describe('CON toggle / callout', () => {
  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-8 undo of turning a toggle with children into text shows the children again', async ({ page }) => {
    await createBlok(page, kidsDoc('toggle'));
    await gap(page);
    await openTunesFor(page, 'box');
    await tune(page, 'convert-to').click();
    await page.locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="paragraph"]`).click();
    await page.keyboard.press('Escape');
    await gap(page);
    const converted = await save(page);

    await undo(page);

    expect(await domTree(page), 'DOM tree after undo').toEqual([
      ['p-before', null], ['box', null], ['k1', 'box'], ['k2', 'box'], ['p-after', null],
    ]);

    await redo(page);
    expect(await save(page), 'redo brings back the converted document').toEqual(converted);
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-12 duplicating a callout copies exactly its children', async ({ page }) => {
    test.fail();
    // Observed: the copy has 3 children, ['kid one', 'kid two', ''] — an extra empty paragraph.
    // Toggle duplicate copies exactly 2. (Duplicate path, not undo.)
    await createBlok(page, kidsDoc('callout'));
    await gap(page);
    await openTunesFor(page, 'box');
    await tune(page, 'duplicate').click();
    await gap(page);

    const saved = await save(page);
    const copy = saved.find(b => b.type === 'callout' && b.id !== 'box');
    const copyTexts = saved.filter(b => b.parent === copy?.id).map(b => b.data.text);

    expect(copyTexts, 'children of the duplicated callout').toEqual(['kid one', 'kid two']);
  });

  test('toggle: delete with children, undo, redo, undo — arrow still toggles', async ({ page }) => {
    await createBlok(page, kidsDoc('toggle'));
    const before = await save(page);

    await gap(page);
    await openTunesFor(page, 'box');
    await tune(page, 'delete').click();
    await gap(page);
    await undo(page);
    await redo(page);
    await undo(page);
    await gap(page);
    expect(await save(page)).toEqual(before);

    await page.locator('[data-blok-id="box"] [data-blok-toggle-arrow]').first().click();
    await gap(page);
    expect((await save(page)).find(b => b.id === 'box')?.data.isOpen).toBe(false);
    await expect(page.getByText('kid one')).toBeHidden();
  });
});

test.describe('CON database', () => {
  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-9 undo of a card title edit updates the board', async ({ page }) => {
    test.fail();
    // Observed: save() is back to 'Card one' but the card still reads 'Renamed' (also via history.undo(),
    // waited 2s). The board only re-projects rows from its own handlers, render and view switch.
    await createBlok(page, DB_DOC);
    await gap(page);
    const card = page.locator('[data-blok-database-card][data-row-id="row-1"]');

    await card.hover();
    await card.locator('[data-blok-database-edit-card]').click();
    const input = card.locator('[data-blok-database-card-title-input]');

    await input.fill('Renamed');
    await input.press('Enter');
    await gap(page);

    await undo(page);

    await expect.poll(async () => (await boardCards(page))[0], { message: 'Todo column after undo', timeout: 2000 }).toEqual(['row-1:Card one']);
    expect((await save(page)).find(b => b.id === 'row-1')?.data.properties).toEqual({ 'prop-title': 'Card one', 'prop-status': 'opt-todo' });
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-10 redo of an added card shows the card on the board', async ({ page }) => {
    test.fail();
    // Observed: after undo + redo the row is back in save() but the board never shows its card.
    await createBlok(page, DB_DOC);
    await gap(page);
    await page.locator('[data-blok-database-add-card][data-option-id="opt-todo"]').click();
    await gap(page);
    const afterAdd = await boardCards(page);

    expect(afterAdd[0]).toHaveLength(2);

    await undo(page);
    await redo(page);

    await expect.poll(async () => boardCards(page), { message: 'board after redo', timeout: 2000 }).toEqual(afterAdd);
  });

  // Undo must restore the exact prior state; redo the exact post-gesture state.
  test('CON-11 undo of a card delete keeps redo, and redo removes the card again', async ({ page }) => {
    test.fail();
    // Observed: canRedo is false right after the undo (4 of 4 runs), so redo does nothing and row-1
    // stays. One earlier run redid the delete but left the card on the board.
    await createBlok(page, DB_DOC);
    await gap(page);
    const card = page.locator('[data-blok-database-card][data-row-id="row-1"]');

    await card.hover();
    await card.locator('[data-blok-database-card-menu]').click();
    await page.getByText('Delete card').click();
    await expect(card).toHaveCount(0);
    await gap(page);

    await undo(page);
    await redo(page);

    expect((await save(page)).some(b => b.id === 'row-1')).toBe(false);
    await expect.poll(async () => (await boardCards(page))[0], { message: 'Todo column after redo', timeout: 2000 }).toEqual([]);
  });
});
