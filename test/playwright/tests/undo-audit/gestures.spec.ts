/**
 * Undo/redo audit, gesture layer (GES): gestures wave 1 did not probe —
 * pointer drags into containers, keyboard moves past containers, the plus
 * button inside a container, table row delete, the database board and inline
 * equations.
 *
 * Expected behaviour everywhere: undo must restore the exact prior state, and
 * redo the exact post-gesture state — in save() AND in the live DOM.
 */
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const MOVE_DOWN = process.platform === 'darwin' ? 'Meta+Shift+ArrowDown' : 'Control+Shift+ArrowDown';
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];
type DomTree = Array<[string, string | null]>;

const mountHolder = async (page: Page): Promise<void> => {
  await page.evaluate(async (holder) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
  }, HOLDER_ID);
};

const createBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await mountHolder(page);
  await page.evaluate(async ({ holder, initial }) => {
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
};

/** Equation is not in the default bundle, so it needs the tools build. */
const createEquationBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await mountHolder(page);
  await page.evaluate(async ({ holder, initial }) => {
    // Runtime-only bundle; the specifier stays non-literal so tsc does not resolve it.
    const toolsUrl = '/dist/tools.mjs';
    const tools = await import(toolsUrl) as { Paragraph: unknown; Equation: unknown };
    const BlokOriginal = (window as unknown as { BlokOriginal: typeof window.Blok }).BlokOriginal;
    const blok = new BlokOriginal({
      holder,
      data: { blocks: initial },
      tools: { paragraph: { class: tools.Paragraph }, equation: { class: tools.Equation } },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
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

/** Each rendered block and the id of the block holder that encloses it in the DOM. */
const domTree = async (page: Page): Promise<DomTree> => page.evaluate((holder) => {
  const root = document.getElementById(holder);

  return root === null
    ? []
    : Array.from(root.querySelectorAll('[data-blok-testid="block-wrapper"]')).map(el => [
      el.getAttribute('data-blok-id') ?? '',
      el.parentElement?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id') ?? null,
    ] as [string, string | null]);
}, HOLDER_ID);

const state = async (page: Page): Promise<{ saved: SavedBlock[]; dom: DomTree }> =>
  ({ saved: await save(page), dom: await domTree(page) });

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO_SHORTCUT);
  await gap(page, 500);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO_SHORTCUT);
  await gap(page, 500);
};

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Park the caret in a plain paragraph so the shortcut reaches Blok. */
const park = async (page: Page, id = 'p-before'): Promise<void> => {
  await editable(page, id).click();
};

/** Hover a block's centre and return the drag handle the toolbar shows for it. */
const grabHandle = async (page: Page, id: string): Promise<Locator> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const handle = page.locator(HANDLE);

  await expect(handle).toBeVisible();

  return handle;
};

/** Pointer drag from the handle to a point in the target block's content box. */
const dragTo = async (page: Page, handle: Locator, targetId: string, xFrac: number, yFrac: number): Promise<void> => {
  const src = await handle.boundingBox();
  const tgt = await page.locator(`[data-blok-id="${targetId}"] [data-blok-element-content]`).first().boundingBox();

  if (src === null || tgt === null) {
    throw new Error('missing boxes for drag');
  }
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(tgt.x + tgt.width * xFrac, tgt.y + tgt.height * yFrac, { steps: 18 });
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/** Select blocks through the blockSelection module, as drag-drop.spec does. */
const selectBlocks = async (page: Page, ids: string[]): Promise<void> => {
  await page.evaluate((blockIds) => {
    const bs = (window.blokInstance as unknown as { module: { blockSelection: { selectBlockByIndex: (i: number) => void } } }).module.blockSelection;

    for (const id of blockIds) {
      const index = window.blokInstance?.blocks.getBlockIndex(id);

      if (index === undefined) {
        throw new Error(`no block ${id}`);
      }
      bs.selectBlockByIndex(index);
    }
  }, ids);
};

const tune = (page: Page, name: string): Locator =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

const P = (id: string, text: string, parent?: string): SavedBlock =>
  parent === undefined ? { id, type: 'paragraph', data: { text } } : { id, type: 'paragraph', data: { text }, parent };

const kidsDoc = (container: 'toggle' | 'callout'): SavedBlock[] => [
  P('p-before', 'before'),
  container === 'toggle'
    ? { id: 'box', type: 'toggle', data: { text: 'Box title', isOpen: true }, content: ['k1', 'k2'] }
    : { id: 'box', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
  P('k1', 'kid one', 'box'),
  P('k2', 'kid two', 'box'),
  P('p-mid', 'outsider one'),
  P('p-mid2', 'outsider two'),
  P('p-after', 'after'),
];

const COLUMNS_DOC: SavedBlock[] = [
  P('p-before', 'before'),
  { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1a', 'p1b'] },
  P('p1a', 'Left top', 'c1'),
  P('p1b', 'Left bottom', 'c1'),
  { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
  P('p2', 'Right only', 'c2'),
  P('p-mid', 'outsider one'),
  P('p-after', 'after'),
];

/** A table as the current version saves it: cell blocks plus row and column ids. */
const tableDoc = (): SavedBlock[] => {
  const cols = ['colA', 'colB'];
  const rows = ['row1', 'row2', 'row3'];
  const kids: SavedBlock[] = [];
  const content = rows.map((rowId, r) => cols.map((colId, c) => {
    const id = `c${r}${c}`;

    kids.push(P(id, `${'AB'[c]}${r + 1}`, 'tbl'));

    return { blocks: [id], id: colId, rowId };
  }));

  return [
    P('p-before', 'before'),
    { id: 'tbl', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content }, content: kids.map(k => k.id ?? '') },
    ...kids,
    P('p-after', 'after'),
  ];
};

type Cell = { id?: string; rowId?: string };

const tableIds = (saved: SavedBlock[]): string[][] => {
  const content = (saved.find(b => b.type === 'table')?.data as { content?: Cell[][] } | undefined)?.content ?? [];

  return content.map(row => row.map(c => `${c.rowId ?? '?'}/${c.id ?? '?'}`));
};

const DB_BOARD: SavedBlock[] = [
  P('p-before', 'before'),
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
  P('p-after', 'after'),
];

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

test.describe('GES pointer drag', () => {
  // Undo must restore the exact prior state; redo the exact post-gesture state.
  // Observed: after one undo the DOM order is p-after, p-mid, p-mid2 (both blocks land AFTER p-after).
  // Redo then interleaves them: k1, p-mid, k2, p-mid2. Same with a callout, and via history.undo().
  test('GES-1: undo of a multi-block drag into a toggle puts the blocks back where they were', async ({ page }) => {
    test.fail();
    await createBlok(page, kidsDoc('toggle'));
    const before = await domTree(page);

    await gap(page);
    await selectBlocks(page, ['p-mid', 'p-mid2']);
    await dragTo(page, await grabHandle(page, 'p-mid'), 'k2', 0.5, 0.1);
    await gap(page);
    expect(await domTree(page)).toContainEqual(['p-mid2', 'box']);

    await park(page);
    await undo(page);

    expect(await domTree(page), 'DOM after one undo').toEqual(before);
  });

  // Undo must restore the exact prior state, and the DOM must match save().
  // Observed: save() is right after undo, but p-mid's holder stays inside cl1 in the DOM:
  // Expected ["p-mid", null], Received ["p-mid", "cl1"].
  test('GES-2: undo of dragging a block beside a column child (third column) takes it out of the column list', async ({ page }) => {
    test.fail();
    await createBlok(page, COLUMNS_DOC);
    const before = await domTree(page);

    await gap(page);
    await dragTo(page, await grabHandle(page, 'p-mid'), 'p2', 0.99, 0.5);
    await gap(page);
    await expect(page.locator('[data-blok-column]')).toHaveCount(3);

    await park(page);
    await undo(page);

    expect(await domTree(page), 'DOM after one undo').toEqual(before);
  });

  test('multi-block drag at root: undo and redo round trip', async ({ page }) => {
    await createBlok(page, kidsDoc('toggle'));
    const before = await state(page);

    await gap(page);
    await selectBlocks(page, ['p-mid', 'p-mid2']);
    await dragTo(page, await grabHandle(page, 'p-mid'), 'p-before', 0.5, 0.1);
    await gap(page);
    const after = await state(page);

    expect(after.dom[0]).toEqual(['p-mid', null]);

    await park(page, 'p-after');
    await undo(page);
    expect(await state(page)).toEqual(before);
    await redo(page);
    expect(await state(page)).toEqual(after);
  });

  for (const container of ['toggle', 'callout'] as const) {
    test(`drag a block into a ${container}: undo and redo round trip`, async ({ page }) => {
      await createBlok(page, kidsDoc(container));
      const before = await state(page);

      await gap(page);
      await dragTo(page, await grabHandle(page, 'p-mid'), 'k2', 0.5, 0.1);
      await gap(page);
      const after = await state(page);

      expect(after.dom).toContainEqual(['p-mid', 'box']);

      await park(page);
      await undo(page);
      expect(await state(page)).toEqual(before);
      await redo(page);
      expect(await state(page)).toEqual(after);
    });
  }
});

test.describe('GES keyboard move', () => {
  // Undo must restore the exact prior state. A flat list and a column list both pass.
  // Observed: the move itself is right (a lands after L2) and canUndo() is true, but undo changes
  // nothing: save() order stays x, xc, a, b. Same via history.undo().
  test('GES-4: undo of Cmd+Shift+Down past a list item with a nested item moves the block back', async ({ page }) => {
    test.fail();
    await createBlok(page, [
      P('a', 'A'),
      { id: 'x', type: 'list', data: { text: 'L1', style: 'unordered' }, content: ['xc'] },
      { id: 'xc', type: 'list', data: { text: 'L2', style: 'unordered', depth: 1 }, parent: 'x' },
      P('b', 'B'),
    ]);
    await gap(page);
    await editable(page, 'a').click();
    await page.keyboard.press(MOVE_DOWN);
    await gap(page);
    expect((await save(page)).map(b => b.id)).toEqual(['x', 'xc', 'a', 'b']);

    await undo(page);

    expect((await save(page)).map(b => b.id), 'saved order after one undo').toEqual(['a', 'x', 'xc', 'b']);
  });
});

test.describe('GES forward reparent outside transactMoves', () => {
  // Undo must restore the exact prior state; the same gesture on a top-level block takes one undo
  // (undo-redo.spec.ts "undo after inserting Header via toolbox removes the header").
  // Observed: undo 1 leaves an empty paragraph in the toggle; undo 2 moves it to the ROOT after k2;
  // undo 3 removes it. Same inside a column. Cause: plus-button.ts:339 calls setBlockParent outside
  // transactMoves, so blockManager.ts:1265 captures that placement write as its own undo entry.
  test('GES-5: one undo of "+ then Heading" on a toggle child removes the new block', async ({ page }) => {
    test.fail();
    await createBlok(page, kidsDoc('toggle'));
    const before = await domTree(page);

    await gap(page);
    await editable(page, 'k1').hover();
    await page.getByTestId('plus-button').click();
    await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="header-2"]').click();
    await gap(page);
    expect(await domTree(page)).toHaveLength(before.length + 1);

    await park(page);
    await undo(page);

    expect(await domTree(page), 'DOM after one undo').toEqual(before);
  });
});

test.describe('GES table', () => {
  test('table block delete: undo keeps cells, row ids and column ids; redo deletes again', async ({ page }) => {
    await createBlok(page, tableDoc());
    const before = await save(page);

    await gap(page);
    await page.locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"]').click();
    await page.locator(HANDLE).click();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    await tune(page, 'delete').click();
    await gap(page);
    expect((await save(page)).some(b => b.type === 'table')).toBe(false);

    await park(page);
    await undo(page);
    const restored = await save(page);

    expect(tableIds(restored)).toEqual(tableIds(before));
    expect(restored).toEqual(before);

    await redo(page);
    expect((await save(page)).some(b => b.type === 'table')).toBe(false);
  });
});

test.describe('GES database board', () => {
  // Redo must give back the post-gesture state on screen. Undo of the same drag does re-project.
  // Observed: after redo save() has row-1 in opt-done, but the board still shows it under Todo:
  // Expected [[], [row-1, row-2]], Received [[row-1], [row-2]]. Cause not proven; may differ from CON-9/CON-10.
  test('GES-7: redo of dragging a card to another column moves the card on the board', async ({ page }) => {
    test.fail();
    await createBlok(page, DB_BOARD);
    await gap(page);
    const s = await page.locator('[data-blok-database-card][data-row-id="row-1"]').boundingBox();
    const t = await page.locator('[data-blok-database-column]').nth(1).boundingBox();

    if (s === null || t === null) {
      throw new Error('no box');
    }
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height - 20, { steps: 20 });
    await page.mouse.up();
    await gap(page);
    const cardsAfter = await boardCards(page);

    expect(cardsAfter).toEqual([[], ['row-1:Card one', 'row-2:Card two']]);

    await park(page);
    await undo(page);
    await expect.poll(async () => boardCards(page)).toEqual([['row-1:Card one'], ['row-2:Card two']]);
    await redo(page);

    await expect.poll(async () => boardCards(page), { message: 'board after redo', timeout: 2000 }).toEqual(cardsAfter);
  });
});

test.describe('GES inline', () => {
  // Redo must give back the exact post-gesture state. Undo is right.
  test('GES-8: redo of an equation edit keeps the text after the equation', async ({ page }) => {
    await createEquationBlok(page, [
      P('p-before', 'before'),
      P('p-eq', 'mass: <span data-latex="E=mc^2">E=mc^2</span> end'),
      P('p-after', 'after'),
    ]);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('span[data-latex] math').length)).toBeGreaterThan(0);
    await gap(page);
    // The chip is KaTeX output with no role or test id, so read its box in-page.
    const box = await page.evaluate(() => {
      const rect = document.querySelector('span[data-latex]')?.getBoundingClientRect();

      return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (box === null) {
      throw new Error('no chip');
    }
    await page.mouse.click(box.x, box.y);
    const input = page.getByTestId('inline-equation-input');

    await input.fill('E=mc^3');
    await input.press('Enter');
    await gap(page);
    const edited = (await save(page)).find(b => b.id === 'p-eq')?.data.text;

    expect(edited).toBe('mass: <span data-latex="E=mc^3">E=mc^3</span> end');

    await park(page);
    await undo(page);
    expect((await save(page)).find(b => b.id === 'p-eq')?.data.text).toBe('mass: <span data-latex="E=mc^2">E=mc^2</span> end');
    await redo(page);

    expect((await save(page)).find(b => b.id === 'p-eq')?.data.text, 'text after redo').toBe(edited);
    await expect(editable(page, 'p-eq')).toContainText('end');
  });
});
