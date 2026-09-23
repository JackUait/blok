import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import {
  gotoCollabPage,
  mountCollabEditor,
  savedBlocks,
  seedDocument,
  type SeedBlock,
} from '../helpers/collab';

/**
 * Undo audit, collab layer: undo/redo in two real editors joined through the
 * BroadcastChannel relay (helpers/collab.ts — two clients max). The unit tier
 * (test/unit/undo-audit/concurrency.test.ts) covers the same cases at the data
 * level only.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const UNDO = `${MOD}+z`;
const REDO = `${MOD}+Shift+z`;
/** Yjs capture window is 500ms; wait past it so gestures stay separate undo steps. */
const CAPTURE_GAP = 700;

const newDoc = (): string => `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const editable = (page: Page, name: string, id: string): Locator =>
  page.getByTestId(name).locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const wait = (page: Page, ms = CAPTURE_GAP): Promise<void> =>
  page.evaluate(async (t) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, t);
    });
  }, ms);

interface Row { id: string; type: string; text: string; parent: string; data: unknown }

/**
 * Saved blocks without the per-client edit stamps. A table's cell blocks are
 * sorted by id: a joiner saves them in another flat order than the author even
 * when every cell matches, and that is not what this file tests.
 */
const saved = async (page: Page, name: string): Promise<Row[]> => {
  const rows = (await savedBlocks(page, name)).map((block) => ({
    id: block.id,
    type: block.type,
    text: block.text,
    parent: block.parent,
    data: block.data,
  }));
  const tables = new Set(rows.filter((row) => row.type === 'table').map((row) => row.id));
  const cells = rows.filter((row) => tables.has(row.parent)).sort((x, y) => x.id.localeCompare(y.id));

  return [...rows.filter((row) => !tables.has(row.parent)), ...cells];
};

const textOf = async (page: Page, name: string, id: string): Promise<string | undefined> =>
  (await saved(page, name)).find((row) => row.id === id)?.text;

interface Pair { a: Page; b: Page }

const pair = async (context: BrowserContext): Promise<Pair> =>
  ({ a: await context.newPage(),
    b: await context.newPage() });

/** Alpha opens the room and seeds it (root blocks only); beta joins. Both histories start empty. */
const setup = async (pages: Pair, blocks: SeedBlock[]): Promise<void> => {
  const doc = newDoc();

  await gotoCollabPage(pages.a);
  await mountCollabEditor(pages.a, { doc,
    name: 'alpha',
    seedsEmptyRoom: true });
  // blocks.insert with no index puts each block at the top, so seed in reverse,
  // then drop the room's opening paragraph.
  await seedDocument(pages.a, 'alpha', [...blocks].reverse());
  await pages.a.evaluate(async (ids) => {
    const editor = window.__collabEditors?.alpha;
    const all = (await editor?.save())?.blocks ?? [];
    const stray = all.find((block) => block.id !== undefined && !ids.includes(block.id) && block.parent === undefined);

    if (stray?.id !== undefined) {
      await editor?.blocks.delete(editor.blocks.getBlockIndex(stray.id));
    }
  }, blocks.map((block) => block.id));
  await gotoCollabPage(pages.b);
  await mountCollabEditor(pages.b, { doc,
    name: 'beta',
    seedsEmptyRoom: false });
  await expect.poll(async () => JSON.stringify(await saved(pages.b, 'beta')))
    .toBe(JSON.stringify(await saved(pages.a, 'alpha')));
  await pages.a.evaluate(() => window.__collabEditors?.alpha.history.clear());
  await pages.b.evaluate(() => window.__collabEditors?.beta.history.clear());
};

/** Waits until both editors save the same document, and returns it. */
const converged = async (pages: Pair): Promise<Row[]> => {
  await expect.poll(async () => JSON.stringify(await saved(pages.b, 'beta')), { timeout: 5000 })
    .toBe(JSON.stringify(await saved(pages.a, 'alpha')));

  return saved(pages.a, 'alpha');
};

const typeAt = async (page: Page, name: string, id: string, where: 'Home' | 'End', text: string): Promise<void> => {
  await editable(page, name, id).click();
  await page.keyboard.press(where);
  await page.keyboard.type(text);
};

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await wait(page, 500);
};

/** How many remote carets this editor draws. */
const remoteCaretCount = (page: Page, name: string): Promise<number> =>
  page.getByTestId(name).locator('[data-blok-presence-caret]:not([data-blok-presence-selection])').count();

/** Legacy string cells: the table tool mints one paragraph per cell on render. */
const TABLE: SeedBlock[] = [
  { id: 'T',
    type: 'table',
    data: { withHeadings: false,
      withHeadingColumn: false,
      content: [['A', 'B'], ['C', 'D']] } },
];

/** Hovers the table's bottom (row) or right (column) edge and clicks the add button. */
const clickAdd = async (page: Page, name: string, what: 'row' | 'col'): Promise<void> => {
  const table = page.getByTestId(name).locator('[data-blok-tool="table"]').first();
  const box = await table.boundingBox();

  if (box === null) {
    throw new Error('no table');
  }
  if (what === 'row') {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5);
  } else {
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  }
  const button = page.getByTestId(name).locator(what === 'row' ? '[data-blok-table-add-row]' : '[data-blok-table-add-col]');

  await expect(button).toBeVisible();
  // The add commits on pointerup; a bare pointerdown adds nothing.
  await button.click();
};

test.describe('undo audit: collab in two real editors', () => {
  test('undo removes only the local typing when the peer typed in the same paragraph', async ({ context }) => {
    const pages = await pair(context);

    await setup(pages, [{ id: 'p',
      data: { text: 'hello world' } }]);
    await typeAt(pages.a, 'alpha', 'p', 'End', ' AAA');
    await wait(pages.a);
    await typeAt(pages.b, 'beta', 'p', 'Home', 'BBB ');
    await wait(pages.b);
    await converged(pages);

    await undo(pages.a);

    expect((await converged(pages)).map((row) => row.text)).toEqual(['BBB hello world']);
    await expect(editable(pages.b, 'beta', 'p')).toHaveText('BBB hello world');
  });

  test('a peer edit inside the local capture window does not split the local undo step', async ({ context }) => {
    const pages = await pair(context);

    await setup(pages, [{ id: 'p',
      data: { text: 'hello' } }]);
    await typeAt(pages.a, 'alpha', 'p', 'End', ' aa');
    await typeAt(pages.b, 'beta', 'p', 'Home', 'X');
    await expect(editable(pages.a, 'alpha', 'p')).toHaveText('Xhello aa');
    await pages.a.keyboard.type('bb');
    await wait(pages.a);
    await converged(pages);

    await undo(pages.a);

    expect((await converged(pages)).map((row) => row.text)).toEqual(['Xhello']);
    await expect(editable(pages.a, 'alpha', 'p')).toHaveText('Xhello');
  });

  // COB-1. The caret restored by undo is the offset recorded before the peer
  // typed in front of it. Undo must put the caret where the undone text was.
  // Observed: Expected "BBB hello world!" Received "BBB hello w!orld"
  test('COB-1: after undo the caret sits where the undone text was, past the peer\'s text', async ({ context }) => {
    test.fail();
    const pages = await pair(context);

    await setup(pages, [{ id: 'p',
      data: { text: 'hello world' } }]);
    await typeAt(pages.a, 'alpha', 'p', 'End', ' AAA');
    await wait(pages.a);
    await typeAt(pages.b, 'beta', 'p', 'Home', 'BBB ');
    await wait(pages.b);
    await converged(pages);

    await undo(pages.a);
    await pages.a.keyboard.type('!');
    await wait(pages.a);

    expect(await textOf(pages.a, 'alpha', 'p')).toBe('BBB hello world!');
    await converged(pages);
  });

  // COB-2. Same on the redo stack: the caret lands at the pre-peer offset.
  // Observed: Expected "B hello world AAA!" Received "B hello world A!AA"
  test('COB-2: after redo the caret sits after the redone text, past the peer\'s text', async ({ context }) => {
    test.fail();
    const pages = await pair(context);

    await setup(pages, [{ id: 'p',
      data: { text: 'hello world' } }]);
    await typeAt(pages.a, 'alpha', 'p', 'End', ' AAA');
    await wait(pages.a);
    await undo(pages.a);
    await converged(pages);
    await typeAt(pages.b, 'beta', 'p', 'Home', 'B ');
    await wait(pages.b);
    await converged(pages);

    await editable(pages.a, 'alpha', 'p').click();
    await pages.a.keyboard.press(REDO);
    await wait(pages.a, 500);
    await pages.a.keyboard.type('!');
    await wait(pages.a);

    expect(await textOf(pages.a, 'alpha', 'p')).toBe('B hello world AAA!');
    await converged(pages);
  });

  // COB-3. Beta's caret was in a block alpha deleted; beta has no caret after
  // that. Alpha's undo brings the block back and alpha draws beta's old caret
  // in it again. Expected: no caret for a peer that has none.
  // Observed: Expected 0 Received 1
  test('COB-3: undoing a delete does not bring back the peer caret that was in the block', async ({ context }) => {
    test.fail();
    const pages = await pair(context);

    await setup(pages, [{ id: 'b1',
      data: { text: 'one' } }, { id: 'b2',
      data: { text: 'two' } }, { id: 'b3',
      data: { text: 'three' } }]);
    await typeAt(pages.b, 'beta', 'b2', 'End', '');
    await wait(pages.b, 400);
    await editable(pages.a, 'alpha', 'b1').click();
    await pages.a.evaluate(async () => {
      const editor = window.__collabEditors?.alpha;

      await editor?.blocks.delete(editor.blocks.getBlockIndex('b2'));
    });
    await wait(pages.a);
    await converged(pages);
    await expect.poll(() => remoteCaretCount(pages.a, 'alpha')).toBe(0);

    await editable(pages.a, 'alpha', 'b1').click();
    await undo(pages.a);
    await wait(pages.a, 400);

    expect(await remoteCaretCount(pages.a, 'alpha')).toBe(0);
    expect(await pages.b.evaluate(() => document.getSelection()?.rangeCount ?? 0)).toBe(0);
    expect((await converged(pages)).map((row) => row.id)).toEqual(['b1', 'b2', 'b3']);
  });

  // COB-4. Not undo: with a live peer, one add-row / add-column click mints
  // extra cell blocks, cell (0,0) gains a stray empty block, and the two
  // editors order it differently, so they never converge. Solo, alone in the
  // room, with the peer paused, or with the peer's frames delivered together:
  // correct. This blocks COL-4/5 in the browser.
  // Observed (row and col), varies per run: { alpha: 8, beta: 8 } (also 10, 12);
  // in some runs a mint storm: { alpha: 595, beta: 'unresponsive' }.
  for (const what of ['row', 'col'] as const) {
    test(`COB-4: one add-${what} click with a live peer adds one cell block per new cell`, async ({ context }) => {
      test.fail();
      const pages = await pair(context);
      // Node-side timers and a bounded DOM count: in some runs a page stops
      // answering, and an unbounded read would time the test out instead.
      const settle = (ms: number): Promise<void> => new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
      const cellBlocks = (page: Page, name: string): Promise<number | 'unresponsive'> => Promise.race([
        page.getByTestId(name).locator('[data-blok-tool="table"] [data-blok-testid="block-wrapper"]').count(),
        settle(3000).then(() => 'unresponsive' as const),
      ]);

      await setup(pages, TABLE);
      await clickAdd(pages.a, 'alpha', what);
      await settle(2000);

      expect({ alpha: await cellBlocks(pages.a, 'alpha'),
        beta: await cellBlocks(pages.b, 'beta') }).toEqual({ alpha: 6,
        beta: 6 });
      await converged(pages);
    });
  }
});
