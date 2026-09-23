import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE_GAP_MS = 700;
const SETTLE_MS = 800;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];

const DB_DOC: OutputData['blocks'] = [
  { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
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
        { id: 'prop-desc', name: 'Description', type: 'richText', position: 'a2' },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
        { id: 'view-2', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: ['prop-title', 'prop-status'] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1', 'row-2'],
  },
  { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'prop-title': 'Card one', 'prop-status': 'opt-todo' } } },
  { id: 'row-2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'prop-title': 'Card two', 'prop-status': 'opt-done' } } },
  { id: 'p-after', type: 'paragraph', data: { text: 'after' } },
];

const mount = async (page: Page, blocks: OutputData['blocks'] = DB_DOC): Promise<void> => {
  await page.evaluate(async (list) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const d = document.createElement('div');

    d.id = 'blok';
    d.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(d);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, blocks);
};

const save = (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no editor');
  }

  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

const wait = (page: Page, ms: number): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const gap = (page: Page): Promise<void> => wait(page, CAPTURE_GAP_MS);

const canUndo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canUndo() ?? false);
const canRedo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

/** Put the caret in a plain paragraph so Cmd+Z goes to Blok, not to a field. */
const park = async (page: Page): Promise<void> => {
  await page.getByText('after', { exact: true }).click();
};

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await wait(page, SETTLE_MS);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await wait(page, SETTLE_MS);
};

/** What the database shows: title, tabs, board columns with cards, list rows. */
const screen = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => {
  const txt = (el: Element | null): string => (el?.textContent ?? '').trim();

  return {
    title: txt(document.querySelector('[data-blok-database-title]')),
    tabs: Array.from(document.querySelectorAll('[data-blok-database-tab]')).map(t =>
      `${t.getAttribute('data-view-id') ?? ''}:${txt(t.querySelector('[data-blok-database-tab-name]'))}${t.hasAttribute('data-active') ? '*' : ''}`),
    columns: Array.from(document.querySelectorAll('[data-blok-database-column]')).map(c =>
      `${c.getAttribute('data-option-id') ?? ''}:${txt(c.querySelector('[data-blok-database-column-title]'))}=[${
        Array.from(c.querySelectorAll('[data-blok-database-card]')).map(k => `${k.getAttribute('data-row-id') ?? ''}:${txt(k.querySelector('[data-blok-database-card-title]'))}`).join(',')}]`),
    list: Array.from(document.querySelectorAll('[data-blok-database-list-row]')).map(r =>
      `${r.getAttribute('data-row-id') ?? ''}:${txt(r.querySelector('[data-blok-database-list-row-title]'))}`),
  };
});

type Snap = { data: SavedBlock[]; view: Record<string, unknown> };

const snap = async (page: Page): Promise<Snap> => ({ data: await save(page), view: await screen(page) });

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

test.describe.configure({ retries: 0 });

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

const openCard = async (page: Page, rowId: string): Promise<void> => {
  await page.locator(`[data-blok-database-card][data-row-id="${rowId}"] [data-blok-database-card-title]`).click();
  await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
  await wait(page, 1200);
};

const closeCard = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-database-drawer-close]').click();
  await wait(page, 1200);
};

const pageBody = (page: Page): Locator => page.getByTestId('blok').locator('[data-blok-database-drawer-editor] [contenteditable="true"]').first();

const rowData = async (page: Page, id: string): Promise<unknown> => (await save(page)).find(b => b.id === id)?.data;

const ids = async (page: Page): Promise<string[]> => (await save(page)).flatMap(b => (b.id === undefined ? [] : [b.id]));

const withoutPageBody = (doc: OutputData['blocks']): OutputData['blocks'] => doc.map(b => (b.id === 'db-1'
  ? { ...b, data: { ...b.data, schema: (b.data.schema as Array<{ type: string }>).filter(p => p.type !== 'richText') } }
  : b));

/** Type in the last paragraph and undo it, so there is a redo to lose. */
const makeRedo = async (page: Page): Promise<void> => {
  await page.getByText('after', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('Z');
  await gap(page);
  await undo(page);
  expect(await canRedo(page)).toBe(true);
};

test.describe('W4D card page (drawer)', () => {
  // Defect: closing the drawer always saves its page-body editor and writes the result
  // ({ time, blocks: [] }) into the row, even when nothing was typed. That write is a new
  // undo step, so it clears redo and puts a phantom step on the stack.
  // Root cause: database-card-drawer.ts:497-499 (cleanupEditor saves unconditionally on close)
  // -> database/index.ts:971-973 onDescriptionChange -> updateRowBlock dispatchChange (index.ts:346-353).
  test('W4D-1: opening and closing a card without edits keeps redo and leaves the row alone', async ({ page }) => {
    test.fail(true, 'W4D-1: drawer close writes the page body into the row');
    await mount(page);
    await gap(page);
    const row1 = await rowData(page, 'row-1');

    await makeRedo(page);
    await openCard(page, 'row-1');
    await closeCard(page);

    expect(await canRedo(page)).toBe(true);
    expect(await canUndo(page)).toBe(false);
    expect(await rowData(page, 'row-1')).toEqual(row1);
  });

  // Control for W4D-1: with no page-body (richText) property the close writes nothing.
  test('W4D-1c: opening and closing a card of a database without a page body keeps redo', async ({ page }) => {
    const doc = withoutPageBody(DB_DOC);

    await mount(page, doc);
    await gap(page);
    const row1 = await rowData(page, 'row-1');

    await makeRedo(page);
    await openCard(page, 'row-1');
    await closeCard(page);

    expect(await canRedo(page)).toBe(true);
    expect(await canUndo(page)).toBe(false);
    expect(await rowData(page, 'row-1')).toEqual(row1);
  });

  // Defect: the close-time save of the page body is its own undo step, so the first undo after
  // typing in a card page and closing it only swaps the saved `time`; the text needs a second undo.
  // Root cause: same as W4D-1 (database-card-drawer.ts:497-499).
  test('W4D-2: one undo after typing in a card page and closing it removes the typed text', async ({ page }) => {
    test.fail(true, 'W4D-2: close-time page save is an extra undo step');
    await mount(page);
    await gap(page);
    const row1 = await rowData(page, 'row-1');

    await openCard(page, 'row-1');
    const body = pageBody(page);

    await body.click();
    await page.keyboard.type('body');
    await wait(page, 1200);
    await closeCard(page);
    await park(page);
    await gap(page);

    await undo(page);

    expect(await rowData(page, 'row-1')).toEqual(row1);
  });

  // Defect: a mousedown in the card page's nested editor reaches the OUTER editor's capture-phase
  // redactor listener. It cannot map the nested holder to one of its own blocks, so it treats the
  // press as "outside any block" and calls Caret.setToTheLastBlock(), which appends an empty
  // paragraph to the outer document (a real undo step) when the last block is not empty.
  // Root cause: uiControllers/handlers/touch.ts:52-58 (setCurrentBlockByChildNode -> undefined ->
  // setToTheLastBlock) -> caret.ts:497-498 insertAtEnd; listener bound in ui.ts:1076 (capture on redactor).
  test('W4D-3: clicking into a card page body adds no block to the outer document', async ({ page }) => {
    test.fail(true, 'W4D-3: outer editor appends a paragraph for a press in the nested page editor');
    await mount(page);
    await gap(page);
    const before = await ids(page);

    await openCard(page, 'row-1');
    const body = pageBody(page);

    await body.click();
    await gap(page);

    expect(await ids(page)).toEqual(before);
    expect(await canUndo(page)).toBe(false);
  });

  // Same press, sent as a bare mousedown (no click): the stray block still appears, so it is the
  // mousedown path (touch.ts), not the bottom-zone click path (ui.ts:1225).
  test('W4D-3b: a bare mousedown in a card page body adds no block to the outer document', async ({ page }) => {
    test.fail(true, 'W4D-3: outer editor appends a paragraph for a press in the nested page editor');
    await mount(page);
    await gap(page);
    const before = await ids(page);

    await openCard(page, 'row-1');
    const body = pageBody(page);

    await body.dispatchEvent('mousedown', { bubbles: true, button: 0 });
    await gap(page);

    expect(await ids(page)).toEqual(before);
  });

  // Controls for W4D-3: a press on the drawer's own title field (inside the database block's own
  // holder) adds nothing, and nothing is added when the outer document already ends in an empty
  // paragraph (setToTheLastBlock then only moves the caret).
  test('W4D-3c: clicking the card title field adds no block to the outer document', async ({ page }) => {
    await mount(page);
    await gap(page);
    const before = await ids(page);

    await openCard(page, 'row-1');
    await page.locator('[data-blok-database-drawer-title]').click();
    await gap(page);

    expect(await ids(page)).toEqual(before);
  });

  test('W4D-3d: clicking into a card page body adds no block when the document ends in an empty paragraph', async ({ page }) => {
    await mount(page, [...DB_DOC, { id: 'p-empty', type: 'paragraph', data: { text: '' } }]);
    await gap(page);
    const before = await ids(page);

    await openCard(page, 'row-1');
    const body = pageBody(page);

    await body.click();
    await gap(page);

    expect(await ids(page)).toEqual(before);
  });
});

type Gesture = { id: string; name: string; doc?: OutputData['blocks']; run: (page: Page) => Promise<void> };

// Double-click, not right-click: a right-click on a tab opens the editor's block menu instead.
// Use the ACTIVE tab: the first click of a double-click on another tab switches the view.
const tabMenu = async (page: Page, viewId: string, item: string): Promise<void> => {
  await page.locator(`[data-blok-database-tab][data-view-id="${viewId}"]`).dblclick();
  await page.getByRole('menuitem').filter({ hasText: item }).click();
  await expect(page.getByRole('menuitem').filter({ hasText: item })).toHaveCount(0);
};

const GESTURES: Gesture[] = [
  { id: 'W4D-C1', name: 'adding a board column', run: async (page) => {
    await page.locator('[data-blok-database-add-column]').click();
  } },
  { id: 'W4D-C2', name: 'renaming a board column', run: async (page) => {
    await page.locator('[data-blok-database-column][data-option-id="opt-todo"] [data-blok-database-column-title]').click();
    const input = page.locator('[data-blok-database-column-title-input]');

    await input.fill('Backlog');
    await input.press('Enter');
  } },
  { id: 'W4D-C3', name: 'deleting a board column with its card', run: async (page) => {
    const col = page.locator('[data-blok-database-column][data-option-id="opt-done"]');

    await col.hover();
    await col.locator('[data-blok-database-delete-column]').click();
  } },
  { id: 'W4D-C4', name: 'dragging a board column before another', run: async (page) => {
    const s = await page.locator('[data-blok-database-column][data-option-id="opt-done"] [data-blok-database-column-count]').boundingBox();
    const t = await page.locator('[data-blok-database-column][data-option-id="opt-todo"]').boundingBox();

    if (s === null || t === null) {
      throw new Error('no box');
    }
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 10, t.y + 20, { steps: 20 });
    await page.mouse.up();
  } },
  { id: 'W4D-C5', name: 'switching the view tab', run: async (page) => {
    await page.locator('[data-blok-database-tab][data-view-id="view-2"]').click();
  } },
  { id: 'W4D-C6', name: 'adding a view', run: async (page) => {
    await page.locator('[data-blok-database-add-view]').click();
    await page.locator('[data-blok-database-view-option="list"]').click();
  } },
  { id: 'W4D-C7', name: 'renaming a view', run: async (page) => {
    await tabMenu(page, 'view-1', 'Rename');
    const input = page.locator('[data-blok-database-tab-rename-input]');

    await input.fill('Everything');
    await input.press('Enter');
  } },
  { id: 'W4D-C8', name: 'deleting a view', run: async (page) => {
    await tabMenu(page, 'view-1', 'Delete');
  } },
  { id: 'W4D-C9', name: 'duplicating a view', run: async (page) => {
    await tabMenu(page, 'view-1', 'Duplicate');
  } },
  { id: 'W4D-C10', name: 'typing in the database title', run: async (page) => {
    await page.locator('[data-blok-database-title]').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' now');
  } },
];

test.describe('W4D database-level gestures (work)', () => {
  for (const g of GESTURES) {
    test(`${g.id}: undo and redo of ${g.name} restore the saved data and the screen`, async ({ page }) => {
      await mount(page, g.doc);
      await gap(page);
      const s0 = await snap(page);

      await g.run(page);
      await gap(page);
      const s1 = await snap(page);

      expect(same(s0, s1)).toBe(false);
      await park(page);
      await gap(page);

      await undo(page);
      expect(await snap(page)).toEqual(s0);
      expect(await canRedo(page)).toBe(true);

      await redo(page);
      expect(await snap(page)).toEqual(s1);
    });
  }
});
