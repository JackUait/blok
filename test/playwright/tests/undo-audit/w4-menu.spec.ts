/**
 * Undo/redo audit, wave 4: block menu and toolbox operations (W4M).
 *
 * Expected everywhere: one undo reverts one menu gesture to the exact prior
 * state, and redo brings back the exact post-gesture state (same ids) — in
 * save() AND in the live DOM.
 */
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;
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

/** Each rendered block: id, tool, and the id of the block holder that encloses it. */
const domTree = async (page: Page): Promise<string[]> => page.evaluate((holder) => {
  const root = document.getElementById(holder);

  return root === null
    ? []
    : Array.from(root.querySelectorAll('[data-blok-testid="block-wrapper"]')).map(el => [
      el.getAttribute('data-blok-id') ?? '',
      el.getAttribute('data-blok-component') ?? '',
      el.parentElement?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id') ?? 'root',
    ].join('|'));
}, HOLDER_ID);

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Park the caret in a plain paragraph so the shortcut reaches Blok, not a popover. */
const park = async (page: Page, id = 'p-before'): Promise<void> => {
  await page.keyboard.press('Escape');
  await editable(page, id).click();
};

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await gap(page, 500);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await gap(page, 500);
};

/**
 * Open the block settings menu for block `id`: hover points of its content box
 * until the menu opens for that block (block settings select their block).
 */
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

const nested = (page: Page, name: string): Locator =>
  page.locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

const duplicate = async (page: Page, id: string): Promise<void> => {
  await openTunes(page, id);
  await tune(page, 'duplicate').click();
};

const convert = async (page: Page, id: string, to: string, tab?: string): Promise<void> => {
  await openTunes(page, id);
  await tune(page, 'convert-to').click();
  if (tab !== undefined) {
    await page.locator(`${NESTED_POPOVER} [data-blok-popover-tab="${tab}"][role="tab"]`).click();
  }
  await nested(page, to).click();
};

type Snapshot = { data: SavedBlock[]; dom: string[] };

const snap = async (page: Page): Promise<Snapshot> => ({ data: await save(page), dom: await domTree(page) });

/**
 * Round trip: gesture, then undo, then redo. Returns every snapshot so a test
 * can assert the defect first.
 */
const roundTrip = async (
  page: Page,
  gesture: () => Promise<void>
): Promise<{ before: Snapshot; after: Snapshot; undone: Snapshot; redone: Snapshot }> => {
  await gap(page);
  const before = await snap(page);

  await gesture();
  await expect.poll(async () => JSON.stringify(await save(page)) !== JSON.stringify(before.data), { timeout: 3000 }).toBe(true);
  await gap(page);
  const after = await snap(page);

  await park(page);
  await undo(page);
  const undone = await snap(page);

  await redo(page);
  const redone = await snap(page);

  return { before, after, undone, redone };
};

const P = (id: string, text: string, parent?: string): SavedBlock =>
  ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

const wrap = (...blocks: SavedBlock[]): SavedBlock[] => [P('p-before', 'before'), ...blocks, P('p-after', 'after')];

const TABLE_BLOCKS: SavedBlock[] = (() => {
  const cols = ['colA', 'colB'];
  const rows = ['row1', 'row2'];
  const kids: SavedBlock[] = [];
  const content = rows.map((rowId, r) => cols.map((colId, c) => {
    const id = `c${r}${c}`;

    kids.push(P(id, `${'AB'[c]}${r + 1}`, 'tbl'));

    return { blocks: [id], id: colId, rowId };
  }));

  return [
    { id: 'tbl', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content }, content: kids.map(k => k.id ?? '') },
    ...kids,
  ];
})();

const DB_BLOCKS: SavedBlock[] = [
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
      title: 'Tasks',
    },
    content: ['row-1', 'row-2'],
  },
  { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'prop-title': 'Card one', 'prop-status': 'opt-todo' } } },
  { id: 'row-2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'prop-title': 'Card two', 'prop-status': 'opt-done' } } },
];

test.describe.configure({ retries: 0 });

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});


const caret = async (page: Page): Promise<{ blockId: string | null; offset: number | null }> => page.evaluate(() => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    return { blockId: null, offset: null };
  }
  const range = selection.getRangeAt(0);
  const anchorEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const editableEl = anchorEl?.closest('[contenteditable="true"]') ?? null;
  const pre = document.createRange();

  if (editableEl !== null) {
    pre.selectNodeContents(editableEl);
    pre.setEnd(range.startContainer, range.startOffset);
  }

  return {
    blockId: anchorEl?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null,
    offset: editableEl === null ? null : pre.toString().length,
  };
});

const plusThen = async (page: Page, id: string, tool: string): Promise<void> => {
  await editable(page, id).hover();
  await page.getByTestId('plus-button').click();
  await page.locator(`[data-blok-testid="popover-item"][data-blok-item-name="${tool}"]`).click();
};

const expectRoundTrip = (r: { before: Snapshot; after: Snapshot; undone: Snapshot; redone: Snapshot }): void => {
  expect.soft(r.undone.data, 'save() after one undo').toEqual(r.before.data);
  expect.soft(r.undone.dom, 'DOM after one undo').toEqual(r.before.dom);
  expect.soft(r.redone.data, 'save() after redo').toEqual(r.after.data);
  expect.soft(r.redone.dom, 'DOM after redo').toEqual(r.after.dom);
};

const LIST_WITH_NESTED: SavedBlock[] = [
  { id: 'x', type: 'list', data: { text: 'Parent item', style: 'unordered' } },
  { id: 'x2', type: 'list', data: { text: 'Nested item', style: 'unordered', depth: 1 } },
];

test.describe('W4M defects', () => {
  // Turning a heading into a toggle heading adopts the following blocks; the adoption and the
  // convert are one undo step (tracked writes, not a move group). CAP-7 is the other direction.
  test('W4M-1: one undo of "heading -> toggle heading" restores the plain heading and its following block', async ({ page }) => {
    await createBlok(page, wrap({ id: 'x', type: 'header', data: { text: 'Title', level: 2 } }));
    const r = await roundTrip(page, () => convert(page, 'x', 'toggle-header-2', 'toggle-heading'));

    expect(r.undone.data, 'save() after one undo').toEqual(r.before.data);
    expect(r.redone.data, 'save() after one redo').toEqual(r.after.data);
    expect(r.after.data.find(b => b.id === 'p-after')?.parent).toBe('x');
  });

  // "+" on a block with text, then Table or Callout: one undo removes the new block and the scaffold.
  // The container seeds its children during the pick; the open block menu holds the step, so the
  // scaffold entry is still the newest when the pick replaces it.
  for (const [n, tool] of [['2a', 'table'], ['2b', 'callout']]) {
    test(`W4M-${n} ${tool}: one undo of "+ then ${tool}" on a block with text leaves no empty paragraph`, async ({ page }) => {
      await createBlok(page, wrap(P('x', 'Plain text')));
      const r = await roundTrip(page, () => plusThen(page, 'x', tool));

      expect(r.undone.data, 'save() after one undo').toEqual(r.before.data);
      expect(r.undone.dom, 'DOM after one undo').toEqual(r.before.dom);
    });
  }

  // Defect: redo of "+ then Table" brings the cell blocks back sorted by id, not in their order.
  // The table's saved `content` list and the flat block order differ from before the undo.
  // The DOM and the table's cell grid (data.content) are the same; only this order changes.
  // Cause: document-store.ts:1175-1177 finds no order list when the parent is not in the doc
  // yet, so :624 writes the child id nowhere, and :513-527 later appends it sorted by id.
  // Hypothesis (the Yjs doc was not read): the seeded cells reach the doc before the table,
  // at block-insertion.ts:300, while the table's own addBlock runs later, at :343.
  test('W4M-3: redo of "+ then Table" keeps the cell blocks in their order', async ({ page }) => {
    test.fail();
    await createBlok(page, wrap(P('x', '')));
    const r = await roundTrip(page, async () => {
      await editable(page, 'x').click();
      await page.getByTestId('plus-button').click();
      await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="table"]').click();
    });
    const tableOf = (s: Snapshot): SavedBlock | undefined => s.data.find(b => b.type === 'table');

    expect(tableOf(r.redone)?.content, 'table child order after redo').toEqual(tableOf(r.after)?.content);
    expect(r.redone.data).toEqual(r.after.data);
  });

  // Redo of a turn-into puts the caret where the turn-into left it. The next gesture start
  // records that caret as the step's caret-after.
  test('W4M-4: redo of "turn into quote" puts the caret back where the turn-into left it', async ({ page }) => {
    await createBlok(page, wrap(P('x', 'Plain text')));
    await gap(page);
    await editable(page, 'x').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await convert(page, 'x', 'quote');
    await gap(page);
    const afterGesture = await caret(page);

    await page.keyboard.press(UNDO);
    await gap(page, 500);
    const afterUndo = await caret(page);

    await page.keyboard.press(REDO);
    await gap(page, 500);

    expect(await caret(page), 'caret after redo').toEqual(afterGesture);
    expect(afterGesture).toEqual({ blockId: 'x', offset: 8 });
    expect(afterUndo).toEqual({ blockId: 'x', offset: 8 });
  });
});

const DUPLICATE_CASES: Array<[string, string, SavedBlock[]]> = [
  ['paragraph', 'x', wrap(P('x', 'Plain text'))],
  ['heading', 'x', wrap({ id: 'x', type: 'header', data: { text: 'Title', level: 2 } })],
  ['list with a nested item', 'x', wrap(...LIST_WITH_NESTED)],
  ['toggle with children', 'x', wrap(
    { id: 'x', type: 'toggle', data: { text: 'Box title', isOpen: true }, content: ['k1', 'k2'] },
    P('k1', 'kid one', 'x'),
    P('k2', 'kid two', 'x')
  )],
  ['quote', 'x', wrap({ id: 'x', type: 'quote', data: { text: 'Quoted', size: 'default' } })],
  ['code', 'x', wrap({ id: 'x', type: 'code', data: { code: 'one\ntwo', language: 'plain' } })],
  ['table', 'tbl', wrap(...TABLE_BLOCKS)],
  ['divider', 'x', wrap({ id: 'x', type: 'divider', data: {} })],
  ['database', 'db-1', wrap(...DB_BLOCKS)],
];

test.describe('W4M controls: duplicate from the block menu', () => {
  for (const [title, id, blocks] of DUPLICATE_CASES) {
    test(`W4M control: duplicate ${title}: one undo removes the copy, redo brings the same copy back`, async ({ page }) => {
      await createBlok(page, blocks);
      const r = await roundTrip(page, () => duplicate(page, id));

      expectRoundTrip(r);
      expect(r.after.data.length, 'the copy exists').toBeGreaterThan(r.before.data.length);
    });
  }

  test('W4M control: duplicate paragraph: undo and redo put the caret in the original and in the copy', async ({ page }) => {
    await createBlok(page, wrap(P('x', 'Plain text')));
    await gap(page);
    await editable(page, 'x').click();
    await page.keyboard.press('End');
    await duplicate(page, 'x');
    await gap(page);
    const afterGesture = await caret(page);

    await page.keyboard.press(UNDO);
    await gap(page, 500);
    expect(await caret(page)).toEqual({ blockId: 'x', offset: 10 });
    await page.keyboard.press(REDO);
    await gap(page, 500);
    expect(await caret(page)).toEqual(afterGesture);
  });
});

const CONVERT_CASES: Array<[string, string, SavedBlock[], string, string?]> = [
  ['paragraph to heading', 'x', wrap(P('x', 'Plain text')), 'header-2', 'heading'],
  ['paragraph to bulleted list', 'x', wrap(P('x', 'Plain text')), 'bulleted-list'],
  ['paragraph to check list', 'x', wrap(P('x', 'Plain text')), 'check-list'],
  ['paragraph to toggle', 'x', wrap(P('x', 'Plain text')), 'toggle'],
  ['paragraph to quote', 'x', wrap(P('x', 'Plain text')), 'quote'],
  ['paragraph to code', 'x', wrap(P('x', 'Plain text')), 'code'],
  ['paragraph to callout', 'x', wrap(P('x', 'Plain text')), 'callout'],
  ['list with a nested item to paragraph', 'x', wrap(...LIST_WITH_NESTED), 'paragraph'],
  ['bulleted list to numbered list', 'x', wrap({ id: 'x', type: 'list', data: { text: 'Item', style: 'unordered' } }), 'numbered-list'],
  ['numbered list to heading', 'x', wrap({ id: 'x', type: 'list', data: { text: 'Item', style: 'ordered' } }), 'header-2', 'heading'],
  ['last heading to toggle heading (nothing to adopt)', 'x', [P('p-before', 'before'), { id: 'x', type: 'header', data: { text: 'Title', level: 2 } }], 'toggle-header-2', 'toggle-heading'],
  ['toggle without children to list', 'x', wrap({ id: 'x', type: 'toggle', data: { text: 'Box title', isOpen: true } }), 'bulleted-list'],
  ['quote to callout', 'x', wrap({ id: 'x', type: 'quote', data: { text: 'Quoted', size: 'default' } }), 'callout'],
  ['multiline code to paragraph', 'x', wrap({ id: 'x', type: 'code', data: { code: 'one\ntwo\nthree', language: 'plain' } }), 'paragraph'],
];

test.describe('W4M controls: turn into from the block menu', () => {
  for (const [title, id, blocks, to, tab] of CONVERT_CASES) {
    test(`W4M control: turn ${title}: one undo restores the block, redo converts it again`, async ({ page }) => {
      await createBlok(page, blocks);
      const r = await roundTrip(page, () => convert(page, id, to, tab));

      expectRoundTrip(r);
      expect(r.after.data, 'the conversion happened').not.toEqual(r.before.data);
    });
  }

  // Table cell paragraphs have no block menu (the toolbar resolves to the table), so "/" is the way in.
  test('W4M control: turn a table cell paragraph into a list with "/": one undo restores the paragraph', async ({ page }) => {
    await createBlok(page, wrap(...TABLE_BLOCKS));
    await gap(page);
    const before = await save(page);

    await editable(page, 'c00').click();
    await page.keyboard.press('End');
    await page.keyboard.type('/bull');
    await gap(page);
    await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="bulleted-list"]').click();
    await gap(page);
    const after = await save(page);

    expect(after.find(b => b.id === 'c00')?.type).toBe('list');
    await park(page);
    await undo(page);
    expect(await save(page)).toEqual(before);
    await redo(page);
    expect(await save(page)).toEqual(after);
  });
});

test.describe('W4M controls: delete from the block menu', () => {
  const cases: Array<[string, string, SavedBlock[]]> = [
    ['list with a nested item', 'x', wrap(...LIST_WITH_NESTED)],
    ['callout with children', 'box', wrap(
      { id: 'box', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
      P('k1', 'kid one', 'box'),
      P('k2', 'kid two', 'box')
    )],
    ['database', 'db-1', wrap(...DB_BLOCKS)],
  ];

  for (const [title, id, blocks] of cases) {
    test(`W4M control: delete ${title}: one undo restores it, redo deletes it again`, async ({ page }) => {
      await createBlok(page, blocks);
      const r = await roundTrip(page, async () => {
        await openTunes(page, id);
        await tune(page, 'delete').click();
      });

      expectRoundTrip(r);
      expect(r.after.data).not.toEqual(r.before.data);
    });
  }
});

test.describe('W4M controls: table cell colour', () => {
  test('W4M control: cell background colour: one undo clears it, redo sets it again', async ({ page }) => {
    await createBlok(page, wrap(...TABLE_BLOCKS));
    const cell = page.locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"]');
    const r = await roundTrip(page, async () => {
      const cellBox = await cell.boundingBox();

      if (cellBox === null) {
        throw new Error('no cell');
      }
      await page.mouse.click(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
      const pill = page.locator('[data-blok-table-selection-pill]');

      await expect(pill).toBeAttached();
      const pillBox = await pill.boundingBox();

      if (pillBox === null) {
        throw new Error('no pill');
      }
      await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
      await pill.click();
      const colorItem = page.locator('[data-blok-testid="popover-item"][data-blok-item-name="cellColor"]');

      await expect(colorItem).toBeVisible();
      await colorItem.hover();
      const tab = page.locator('[data-blok-testid="cell-color-tab-backgroundColor"]');

      await expect(tab).toBeVisible();
      if (await tab.getAttribute('aria-selected') !== 'true') {
        await tab.click();
      }
      await page.locator('[data-blok-testid="cell-color-swatch-backgroundColor-orange"]').click({ force: true });
      await page.keyboard.press('Escape');
    });

    expect.soft(r.undone.data, 'save() after one undo').toEqual(r.before.data);
    expect.soft(r.redone.data, 'save() after redo').toEqual(r.after.data);
    expect(await cell.evaluate(el => (el as HTMLElement).style.backgroundColor), 'colour on screen after redo').not.toBe('');
  });
});

test.describe('W4M controls: toolbox insert', () => {
  for (const tool of ['header-2', 'bulleted-list', 'toggle', 'quote', 'code', 'divider', 'database']) {
    test(`W4M control: "+ then ${tool}" on a block with text: one undo removes the new block, redo brings it back`, async ({ page }) => {
      await createBlok(page, wrap(P('x', 'Plain text')));
      const r = await roundTrip(page, () => plusThen(page, 'x', tool));

      expectRoundTrip(r);
      expect(r.after.data).not.toEqual(r.before.data);
    });
  }

  test('W4M control: "+ then Heading" on a block with text after a pause: still one undo', async ({ page }) => {
    await createBlok(page, wrap(P('x', 'Plain text')));
    const r = await roundTrip(page, async () => {
      await editable(page, 'x').hover();
      await page.getByTestId('plus-button').click();
      await gap(page, 1200);
      await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="header-2"]').click();
    });

    expect(r.undone.data).toEqual(r.before.data);
  });

  test('W4M control: "+ then Heading" on an empty block: one undo gives the empty paragraph back', async ({ page }) => {
    await createBlok(page, wrap(P('x', '')));
    const r = await roundTrip(page, async () => {
      await editable(page, 'x').click();
      await page.getByTestId('plus-button').click();
      await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="header-2"]').click();
    });

    expectRoundTrip(r);
    expect(r.after.data).not.toEqual(r.before.data);
  });
});
