/**
 * Undo/redo audit, redo-loss layer (RDO): where a redo is silently lost, or an
 * undo/redo cycle leaves the stacks out of step with the document.
 *
 * Expected behaviour everywhere: undo must restore the exact prior state, redo
 * the exact post-gesture state, and neither may be followed by an editor write
 * that lands as a new undo step.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const MOVE_DOWN_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+ArrowDown' : 'Control+Shift+ArrowDown';
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;
// Longer than the 400ms write-buffer window, so deferred write-backs have landed.
const SETTLE = 1200;
const IMAGE_URL = 'http://localhost:4444/test/playwright/fixtures/image/shot.png';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

const save = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('Blok instance not found');
  }

  // lastEdited* is authorship metadata, not document state.
  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

const canRedo = async (page: Page): Promise<boolean> =>
  page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

const editable = (id: string): string => `[data-blok-id="${id}"] [contenteditable="true"]`;

const typeAtEnd = async (page: Page, id: string, text: string): Promise<void> => {
  await page.locator(editable(id)).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};

const textOf = (blocks: SavedBlock[], id: string): unknown =>
  (blocks.find((b) => b.id === id)?.data as { text?: unknown } | undefined)?.text;

const P = (id: string, text: string): SavedBlock => ({ id, type: 'paragraph', data: { text } });

// A host document that never stored the image's natural size, which is what
// every image saved before naturalWidth/naturalHeight existed looks like.
const IMAGE_DOC: OutputData['blocks'] = [P('a', 'A'), { id: 't', type: 'image', data: { url: IMAGE_URL, alt: 'pic' } }, P('b', 'B')];

// A database block without the `title` key; the tool's save() always emits one.
const DATABASE_DOC: OutputData['blocks'] = [
  P('a', 'A'),
  {
    id: 't',
    type: 'database',
    data: {
      schema: [{ id: 'prop-title', name: 'Title', type: 'title', position: 'a0' }],
      views: [{ id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['prop-title'] }],
      activeViewId: 'view-1',
    },
    content: [],
  },
  P('b', 'B'),
];

/**
 * Run each step as its own gesture, undo back to the start, then redo the same
 * number of presses. Steps may span several undo entries (a markdown shortcut
 * is two), so the undo loop stops when the document is back at the start.
 */
const roundTrip = async (
  page: Page,
  blocks: OutputData['blocks'],
  steps: Array<(p: Page) => Promise<void>>
): Promise<{ actual: unknown; expected: unknown }> => {
  await createBlok(page, blocks);
  await wait(page, CAPTURE_GAP);
  const states = [await save(page)];

  for (const step of steps) {
    await step(page);
    await wait(page, SETTLE);
    states.push(await save(page));
  }

  const start = JSON.stringify(states[0]);
  const undone: SavedBlock[][] = [];
  const redoAfterUndo: boolean[] = [];

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);
    const now = await save(page);

    undone.push(now);
    redoAfterUndo.push(await canRedo(page));
    if (JSON.stringify(now) === start) {
      break;
    }
  }

  const redone: SavedBlock[][] = [];

  for (let i = 0; i < undone.length; i++) {
    await page.keyboard.press(REDO_SHORTCUT);
    await wait(page, SETTLE);
    redone.push(await save(page));
  }

  // Redo must retrace the undo trail backwards and land on the final state.
  const expectedRedo = [...undone].reverse().slice(1);

  expectedRedo.push(states[states.length - 1]);

  return {
    actual: { reachedStart: undone.at(-1), redoAfterUndo, redone },
    expected: { reachedStart: states[0], redoAfterUndo: undone.map(() => true), redone: expectedRedo },
  };
};

test.describe('undo audit: redo loss', () => {
  test.setTimeout(60000);

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // Observed: expect(canRedo).toBe(true) -> Received: false. canRedo is still
  // true 350ms after the undo and false by 400ms.
  test('RDO-1a: undoing an image delete keeps redo available', async ({ page }) => {
    test.fail(true, 'RDO-1: image natural-size write-back after an undo is tracked and clears redo');
    await createBlok(page, IMAGE_DOC);
    await wait(page, CAPTURE_GAP);
    const before = await save(page);

    await page.locator(editable('a')).click();
    await page.evaluate(async () => {
      await window.blokInstance?.blocks.delete(1);
    });
    await wait(page, SETTLE);
    const deleted = await save(page);

    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);

    expect(await canRedo(page)).toBe(true);

    expect(await save(page)).toStrictEqual(before);
    await page.keyboard.press(REDO_SHORTCUT);
    await wait(page, SETTLE);
    expect(await save(page)).toStrictEqual(deleted);
  });

  // Observed: types after one undo are ['paragraph', 'image', 'paragraph'];
  // four undos never remove it nor reach the 'Z'. Inserting with
  // naturalWidth/naturalHeight preset makes one undo remove it.
  test('RDO-1b: undo after inserting an image removes it and reaches earlier edits', async ({ page }) => {
    test.fail(true, 'RDO-1: undo loops on the image natural-size write-back');
    await createBlok(page, [P('a', 'A'), P('b', 'B')]);
    await wait(page, CAPTURE_GAP);
    await typeAtEnd(page, 'a', 'Z');
    await wait(page, CAPTURE_GAP);
    await page.evaluate((url) => {
      window.blokInstance?.blocks.insert('image', { url }, undefined, 1);
    }, IMAGE_URL);
    await wait(page, SETTLE);
    await page.locator(editable('b')).click();

    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);

    expect((await save(page)).map((b) => b.type)).toStrictEqual(['paragraph', 'paragraph']);

    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);
    expect(textOf(await save(page), 'a')).toBe('A');
  });

  // Observed: expect(canRedo).toBe(true) -> Received: false. canRedo is true
  // after the first animation frame and false after the second.
  test('RDO-2a: undoing a database delete keeps redo available', async ({ page }) => {
    test.fail(true, 'RDO-2: database title write-back after an undo is tracked and clears redo');
    await createBlok(page, DATABASE_DOC);
    await wait(page, CAPTURE_GAP);
    const before = await save(page);

    await page.locator(editable('a')).click();
    await page.evaluate(async () => {
      await window.blokInstance?.blocks.delete(1);
    });
    await wait(page, SETTLE);
    const deleted = await save(page);

    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);

    expect(await canRedo(page)).toBe(true);

    expect(await save(page)).toStrictEqual(before);
    await page.keyboard.press(REDO_SHORTCUT);
    await wait(page, SETTLE);
    expect(await save(page)).toStrictEqual(deleted);
  });

  // Observed: Expected "A", Received "AZ". Each undo pops the database's
  // write-back, which the re-render writes again.
  test('RDO-2b: after undoing a database delete, further undos reach earlier edits', async ({ page }) => {
    test.fail(true, 'RDO-2: undo loops on the database title write-back');
    await createBlok(page, DATABASE_DOC);
    await wait(page, CAPTURE_GAP);
    await typeAtEnd(page, 'a', 'Z');
    await wait(page, CAPTURE_GAP);
    await page.evaluate(async () => {
      await window.blokInstance?.blocks.delete(1);
    });
    await wait(page, SETTLE);

    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);
    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);
    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);

    expect(textOf(await save(page), 'a')).toBe('A');
  });

  test('RDO-3: undo of Cmd+Shift+Down past an open toggle puts the block back', async ({ page }) => {
    await createBlok(page, [
      P('a', 'A'),
      { id: 't', type: 'toggle', data: { text: 'Tog', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'inside' }, parent: 't' },
      P('b', 'B'),
    ]);
    await wait(page, CAPTURE_GAP);
    const before = await save(page);

    await page.locator(editable('a')).click();
    await page.keyboard.press(MOVE_DOWN_SHORTCUT);
    await wait(page, SETTLE);
    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, SETTLE);

    const inToggle = await page.evaluate(() => {
      const holder = document.querySelector('[data-blok-id="a"]');

      return holder?.parentElement?.closest('[data-blok-id="t"]') !== null;
    });

    expect({ inToggle, saved: (await save(page)).map((b) => b.id) }).toStrictEqual({
      inToggle: false,
      saved: before.map((b) => b.id),
    });
  });

  test('round trip: numbered list edit, indent, Enter', async ({ page }) => {
    const li = (id: string, text: string): SavedBlock => ({ id, type: 'list', data: { text, style: 'ordered' } });

    const { actual, expected } = await roundTrip(page, [li('l1', 'one'), li('l2', 'two'), li('l3', 'three')], [
      async (p) => typeAtEnd(p, 'l2', ' X'),
      async (p) => {
        await p.locator(editable('l2')).click();
        await p.keyboard.press('Home');
        await p.keyboard.press('Tab');
      },
      async (p) => {
        await typeAtEnd(p, 'l3', '');
        await p.keyboard.press('Enter');
        await p.keyboard.type('four');
      },
    ]);

    expect(actual).toStrictEqual(expected);
  });

  test('round trip: paragraph edit, keyboard move, markdown convert', async ({ page }) => {
    const { actual, expected } = await roundTrip(page, [P('p1', 'one'), P('p2', 'two'), P('p3', '')], [
      async (p) => typeAtEnd(p, 'p1', ' X'),
      async (p) => {
        await p.locator(editable('p1')).click();
        await p.keyboard.press(MOVE_DOWN_SHORTCUT);
      },
      async (p) => typeAtEnd(p, 'p3', '# '),
    ]);

    expect(actual).toStrictEqual(expected);
  });
});
