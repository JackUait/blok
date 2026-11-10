import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

/**
 * Which kind of block a split or merge leaves, as in Notion
 * (docs/plans/replica-undo/notion-measured-A.md U145, -B.md U098 U134,
 * -C.md U093 U137). Each gesture is one undo step.
 */

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

interface Caret {
  blockId: string | null;
  offset: number | null;
}

const create = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: data } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

/** Saved blocks as "id type:text" plus "^parent" when nested. */
const saved = async (page: Page): Promise<string[]> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

  return blocksAsHtml(blocks).map((block) => {
    const text = (block.data as { text?: string }).text ?? '';
    const parent = typeof block.parent === 'string' ? ` ^${block.parent}` : '';

    return `${block.id ?? '?'} ${block.type}:${text}${parent}`;
  });
};

/**
 * Holders in DOM order as "id@depth". A plain parent's children are root
 * holders indented by depth, so DOM nesting alone cannot say who the parent is.
 */
const domTree = async (page: Page): Promise<string[]> => page.evaluate((holder) =>
  Array.from(document.querySelectorAll(`#${holder} [data-blok-element][data-blok-id]`))
    .map((el) => `${el.getAttribute('data-blok-id') ?? '?'}@${el.getAttribute('data-blok-depth') ?? '0'}`), HOLDER_ID);

/** Fails when save() and the DOM disagree on order or depth. */
const expectSaveMatchesDom = async (page: Page): Promise<void> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);
  const parentOf = new Map(blocks.map((block) => [block.id, block.parent]));
  const depthOf = (id: string | undefined): number => {
    const parent = id === undefined ? undefined : parentOf.get(id);

    return typeof parent === 'string' ? 1 + depthOf(parent) : 0;
  };

  expect(await domTree(page)).toEqual(blocks.map((block) => `${block.id ?? '?'}@${depthOf(block.id)}`));
};

/** Left edge of a block's own text. */
const textLeft = async (page: Page, blockId: string): Promise<number> =>
  (await page.locator(`#${HOLDER_ID} [data-blok-id="${blockId}"] [contenteditable="true"]`).first().boundingBox())?.x ?? -1;

const caret = async (page: Page): Promise<Caret> => page.evaluate(() => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    return { blockId: null, offset: null };
  }

  const range = selection.getRangeAt(0);
  const anchor = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const editable = anchor?.closest('[contenteditable="true"]') ?? null;
  const pre = document.createRange();

  if (editable === null) {
    return { blockId: null, offset: null };
  }
  pre.selectNodeContents(editable);
  pre.setEnd(range.startContainer, range.startOffset);

  return { blockId: anchor?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null, offset: pre.toString().length };
});

/** Focus a block's own editable and collapse the caret at a text offset, as a click would. */
const placeCaret = async (page: Page, blockId: string, offset: number): Promise<void> => {
  await page.locator(`#${HOLDER_ID} [data-blok-id="${blockId}"] [contenteditable="true"]`).first().click();
  await page.evaluate(({ id, off }) => {
    const editable = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [contenteditable="true"]`);
    const text = editable?.firstChild;

    if (editable === null || text === null || text === undefined) {
      throw new Error(`no text in ${id}`);
    }
    window.getSelection()?.collapse(text, off);
  }, { id: blockId, off: offset });
  await wait(page, 300);
};

/** Open a toggle with its arrow; open state is per viewer, not in the saved data. */
const openToggle = async (page: Page, blockId: string): Promise<void> => {
  const arrow = page.locator(`#${HOLDER_ID} [data-blok-id="${blockId}"] [aria-expanded]`).first();

  await arrow.click();
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  await wait(page, 300);
};

/** Press, then wait past the typing window so the next press opens its own step. */
const press = async (page: Page, key: string): Promise<void> => {
  await page.keyboard.press(key);
  await wait(page, 1000);
};

/** The id save() gives the block that is not in `known`. */
const newId = async (page: Page, known: string[]): Promise<string> => {
  const ids = (await saved(page)).map((entry) => entry.split(' ')[0]);
  const fresh = ids.filter((id) => !known.includes(id));

  expect(fresh).toHaveLength(1);

  return fresh[0];
};

test.describe('undo audit: the kind of block a split or merge leaves', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U098: Backspace at a heading start merges it into the text above in one step', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b2', type: 'header', data: { text: 'Beta', level: 2 } },
    ]);
    await placeCaret(page, 'b2', 0);

    await press(page, 'Backspace');
    expect(await saved(page)).toEqual(['b1 paragraph:AlphaBeta']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 5 });
    await expectSaveMatchesDom(page);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Alpha', 'b2 header:Beta']);
    expect(await caret(page)).toEqual({ blockId: 'b2', offset: 0 });
    await expectSaveMatchesDom(page);

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 paragraph:AlphaBeta']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 5 });
    await expectSaveMatchesDom(page);
  });

  test('U098 edge: a first-block heading still turns into text (no Notion entry)', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'header', data: { text: 'Beta', level: 2 } },
      { id: 'b2', type: 'paragraph', data: { text: 'Gamma' } },
    ]);
    await placeCaret(page, 'b1', 0);

    await press(page, 'Backspace');
    const after = await saved(page);

    expect(after.map((entry) => entry.slice(entry.indexOf(' ') + 1))).toEqual(['paragraph:Beta', 'paragraph:Gamma']);
    await expectSaveMatchesDom(page);
  });

  test('U098 data safety: a heading with a nested child merges and keeps the child', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Alpha' } },
      { id: 'b2', type: 'header', data: { text: 'Beta', level: 2 }, content: ['b3'] },
      { id: 'b3', type: 'paragraph', data: { text: 'kid' }, parent: 'b2' },
    ]);
    await placeCaret(page, 'b2', 0);

    await press(page, 'Backspace');
    const after = await saved(page);

    expect(after[0]).toBe('b1 paragraph:AlphaBeta');
    expect(after.some((entry) => entry.startsWith('b3 paragraph:kid'))).toBe(true);
    await expectSaveMatchesDom(page);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Alpha', 'b2 header:Beta', 'b3 paragraph:kid ^b2']);
    await expectSaveMatchesDom(page);

    await press(page, REDO);
    expect(await saved(page)).toEqual(after);
    await expectSaveMatchesDom(page);
  });

  test('U098 edge: a heading below code or a closed toggle still turns into text (no Notion entry)', async ({ page }) => {
    await create(page, [
      { id: 'c1', type: 'code', data: { code: 'x=1', language: 'plain' } },
      { id: 'h1', type: 'header', data: { text: 'Beta', level: 2 } },
      { id: 't1', type: 'toggle', data: { text: 'Tog' }, content: ['k1'] },
      { id: 'k1', type: 'paragraph', data: { text: 'kid' }, parent: 't1' },
      { id: 'h2', type: 'header', data: { text: 'Gamma', level: 2 } },
    ]);

    await placeCaret(page, 'h1', 0);
    await press(page, 'Backspace');
    await placeCaret(page, 'h2', 0);
    await press(page, 'Backspace');

    expect((await saved(page)).slice(1)).toEqual(['h1 paragraph:Beta', 't1 toggle:Tog', 'k1 paragraph:kid ^t1', 'h2 paragraph:Gamma']);
    expect(await page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0].data)).toMatchObject({ code: 'x=1' });
    await expectSaveMatchesDom(page);
  });

  test('U137 edge: a selection that ends at the toggle title start is deleted, not converted', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Above' } },
      { id: 'b2', type: 'toggle', data: { text: 'Tog' } },
    ]);
    await placeCaret(page, 'b2', 2);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');

    await press(page, 'Backspace');
    expect(await saved(page)).toEqual(['b1 paragraph:Above', 'b2 toggle:g']);
  });

  test('U137: Backspace at a toggle title start turns it into text in place and keeps the child nested', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Above' } },
      { id: 'b2', type: 'toggle', data: { text: 'Tog' }, content: ['b3'] },
      { id: 'b3', type: 'paragraph', data: { text: 'kid' }, parent: 'b2' },
    ]);
    await openToggle(page, 'b2');
    await placeCaret(page, 'b2', 0);

    await press(page, 'Backspace');
    expect(await saved(page)).toEqual(['b1 paragraph:Above', 'b2 paragraph:Tog', 'b3 paragraph:kid ^b2']);
    expect(await caret(page)).toEqual({ blockId: 'b2', offset: 0 });
    await expectSaveMatchesDom(page);
    await expect(page.getByText('kid', { exact: true })).toBeVisible();
    expect(await textLeft(page, 'b3')).toBeGreaterThan(await textLeft(page, 'b2'));

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Above', 'b2 toggle:Tog', 'b3 paragraph:kid ^b2']);
    expect(await caret(page)).toEqual({ blockId: 'b2', offset: 0 });
    await expectSaveMatchesDom(page);

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Above', 'b2 paragraph:Tog', 'b3 paragraph:kid ^b2']);
    expect(await caret(page)).toEqual({ blockId: 'b2', offset: 0 });
    await expectSaveMatchesDom(page);
  });

  test('U137 closed: a closed toggle turned into text shows its child (no Notion entry)', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Above' } },
      { id: 'b2', type: 'toggle', data: { text: 'Tog' }, content: ['b3'] },
      { id: 'b3', type: 'paragraph', data: { text: 'kid' }, parent: 'b2' },
    ]);
    await placeCaret(page, 'b2', 0);

    await press(page, 'Backspace');
    expect(await saved(page)).toEqual(['b1 paragraph:Above', 'b2 paragraph:Tog', 'b3 paragraph:kid ^b2']);
    await expectSaveMatchesDom(page);
    await expect(page.getByText('kid', { exact: true })).toBeVisible();
    expect(await textLeft(page, 'b3')).toBeGreaterThan(await textLeft(page, 'b2'));

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Above', 'b2 toggle:Tog', 'b3 paragraph:kid ^b2']);
    await expectSaveMatchesDom(page);

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 paragraph:Above', 'b2 paragraph:Tog', 'b3 paragraph:kid ^b2']);
    await expectSaveMatchesDom(page);
    await expect(page.getByText('kid', { exact: true })).toBeVisible();
  });

  test('U093: Enter in the middle of a heading puts the second half in a text block', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'header', data: { text: 'Big title', level: 1 } }]);
    await placeCaret(page, 'b1', 3);

    await press(page, 'Enter');
    const fresh = await newId(page, ['b1']);

    expect(await saved(page)).toEqual(['b1 header:Big', `${fresh} paragraph: title`]);
    expect(await caret(page)).toEqual({ blockId: fresh, offset: 0 });
    await expectSaveMatchesDom(page);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 header:Big title']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 3 });
    await expectSaveMatchesDom(page);

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 header:Big', `${fresh} paragraph: title`]);
    expect(await caret(page)).toEqual({ blockId: fresh, offset: 0 });
    await expectSaveMatchesDom(page);
  });

  test('U145: Enter in the middle of a quote puts the second half in a text block', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'quote', data: { text: 'Quoted line' } }]);
    await placeCaret(page, 'b1', 6);

    await press(page, 'Enter');
    const fresh = await newId(page, ['b1']);

    expect(await saved(page)).toEqual(['b1 quote:Quoted', `${fresh} paragraph: line`]);
    expect(await caret(page)).toEqual({ blockId: fresh, offset: 0 });
    await expectSaveMatchesDom(page);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 quote:Quoted line']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 6 });
    await expectSaveMatchesDom(page);

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 quote:Quoted', `${fresh} paragraph: line`]);
    expect(await caret(page)).toEqual({ blockId: fresh, offset: 0 });
    await expectSaveMatchesDom(page);
  });

  test('Enter at the end of a heading or a quote opens a text block', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'header', data: { text: 'Title', level: 2 } },
      { id: 'b2', type: 'quote', data: { text: 'Said' } },
    ]);
    await placeCaret(page, 'b1', 5);
    await press(page, 'Enter');
    const afterHeading = await newId(page, ['b1', 'b2']);

    await placeCaret(page, 'b2', 4);
    await press(page, 'Enter');
    const afterQuote = await newId(page, ['b1', 'b2', afterHeading]);

    expect(await saved(page)).toEqual(['b1 header:Title', `${afterHeading} paragraph:`, 'b2 quote:Said', `${afterQuote} paragraph:`]);
    await expectSaveMatchesDom(page);
  });

  test('U134: Enter at the end of an open toggle title inserts its FIRST child', async ({ page }) => {
    await create(page, [
      { id: 'b1', type: 'toggle', data: { text: 'Tog' }, content: ['b2'] },
      { id: 'b2', type: 'paragraph', data: { text: 'kid' }, parent: 'b1' },
    ]);
    await openToggle(page, 'b1');
    await placeCaret(page, 'b1', 3);

    await press(page, 'Enter');
    const fresh = await newId(page, ['b1', 'b2']);

    expect(await saved(page)).toEqual(['b1 toggle:Tog', `${fresh} paragraph: ^b1`, 'b2 paragraph:kid ^b1']);
    expect(await caret(page)).toEqual({ blockId: fresh, offset: 0 });
    await expectSaveMatchesDom(page);

    await press(page, UNDO);
    expect(await saved(page)).toEqual(['b1 toggle:Tog', 'b2 paragraph:kid ^b1']);
    expect(await caret(page)).toEqual({ blockId: 'b1', offset: 3 });
    await expectSaveMatchesDom(page);

    await press(page, REDO);
    expect(await saved(page)).toEqual(['b1 toggle:Tog', `${fresh} paragraph: ^b1`, 'b2 paragraph:kid ^b1']);
    expect(await caret(page)).toEqual({ blockId: fresh, offset: 0 });
    await expectSaveMatchesDom(page);
  });
});
