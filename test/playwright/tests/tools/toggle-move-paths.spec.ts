import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Every path that moves blocks — not only the pointer drag — keeps a toggle's
 * children right after it, keeps each block inside the holder of its parent,
 * and undoes in one step.
 */

const HOLDER_ID = 'blok';
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const UNDO = `${MOD}+z`;
const MOVE_UP = `${MOD}+Shift+ArrowUp`;
const MOVE_DOWN = `${MOD}+Shift+ArrowDown`;
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

type BlockData = OutputData['blocks'][number];

interface Row {
  id: string;
  parent: string | null;
}

const toggle = (id: string, content: string[], extra: Partial<BlockData> = {}): BlockData =>
  ({ id, type: 'toggle', data: { text: `Toggle ${id}`, isOpen: true }, content, ...extra });

const paragraph = (id: string, parent?: string): BlockData => ({
  id,
  type: 'paragraph',
  data: { text: `Paragraph ${id}` },
  ...(parent !== undefined ? { parent } : {}),
});

const createBlok = async (page: Page, blocks: BlockData[]): Promise<void> => {
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

const gap = async (page: Page): Promise<void> => {
  await page.evaluate(async (ms) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }, CAPTURE_GAP);
};

const save = async (page: Page): Promise<Row[]> =>
  await page.evaluate(async () => {
    const output = await window.blokInstance?.save();

    return (output?.blocks ?? []).map(block => ({ id: block.id ?? '', parent: block.parent ?? null }));
  });

/** Each block and the block whose holder encloses it on screen, in document order. */
const screen = async (page: Page): Promise<Row[]> =>
  await page.evaluate((holder) => Array.from(
    document.querySelectorAll(`#${holder} [data-blok-testid="block-wrapper"]`)
  ).map(element => ({
    id: element.getAttribute('data-blok-id') ?? '',
    parent: element.parentElement?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id') ?? null,
  })), HOLDER_ID);

const titleOf = (id: string): string => `[data-blok-id="${id}"] [contenteditable="true"]`;

const pressOn = async (page: Page, id: string, key: string): Promise<void> => {
  await page.locator(titleOf(id)).first().click();
  await page.keyboard.press(key);
};

const boxOf = async (page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await page.locator(selector).first().boundingBox();

  if (box === null) {
    throw new Error(`missing bounding box for ${selector}`);
  }

  return box;
};

/**
 * Pointer drag of block `id` by its handle, straight down or up to `targetY`.
 * @param page - test page
 * @param id - block to drag
 * @param targetY - resolves the drop y
 * @param alt - hold Alt to duplicate
 */
const dragByHandle = async (page: Page, id: string, targetY: () => Promise<number>, alt = false): Promise<void> => {
  const title = await boxOf(page, titleOf(id));

  await page.mouse.move(title.x + 10, title.y + title.height / 2);
  await expect(page.locator(HANDLE)).toBeVisible();

  const handle = await boxOf(page, HANDLE);
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 6, { steps: 3 });
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true'
  );
  if (alt) {
    await page.keyboard.down('Alt');
  }
  await page.mouse.move(startX + 2, await targetY(), { steps: 15 });
  await page.mouse.up();
  if (alt) {
    await page.keyboard.up('Alt');
  }
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true'
  );
};

interface Tree {
  saved: Row[];
  screen: Row[];
}

const tree = async (page: Page): Promise<Tree> => ({ saved: await save(page), screen: await screen(page) });

/**
 * The tree after the gesture, then after one undo.
 * @param page - test page
 * @param viaApi - undo through history.undo(): an API move leaves no focus in the editor
 */
const afterAndUndo = async (page: Page, viaApi = false): Promise<{ after: Tree; undone: Tree }> => {
  const after = await tree(page);

  await gap(page);
  if (viaApi) {
    await page.evaluate(() => {
      window.blokInstance?.history.undo();
    });
  } else {
    await page.keyboard.press(UNDO);
  }
  await expect.poll(async () => await save(page)).not.toEqual(after.saved);

  return { after, undone: await tree(page) };
};

/** Saved and on-screen trees agree with `rows`. */
const both = (rows: Row[]): Tree => ({ saved: rows, screen: rows });

test.describe('toggle move paths', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Cmd+Shift+Down on a block above a toggle with a child lands after the child', async ({ page }) => {
    await createBlok(page, [paragraph('a'), toggle('t', ['tc']), paragraph('tc', 't'), paragraph('b')]);
    await gap(page);
    const before = await save(page);

    await pressOn(page, 'a', MOVE_DOWN);

    expect(await afterAndUndo(page)).toEqual({ after: both([
      { id: 't', parent: null },
      { id: 'tc', parent: 't' },
      { id: 'a', parent: null },
      { id: 'b', parent: null },
    ]), undone: both(before) });
  });

  test('Cmd+Shift+Up on a toggle with a child carries the child along', async ({ page }) => {
    await createBlok(page, [paragraph('a'), toggle('t', ['tc']), paragraph('tc', 't'), paragraph('b')]);
    await gap(page);
    const before = await save(page);

    await pressOn(page, 't', MOVE_UP);

    expect(await afterAndUndo(page)).toEqual({ after: both([
      { id: 't', parent: null },
      { id: 'tc', parent: 't' },
      { id: 'a', parent: null },
      { id: 'b', parent: null },
    ]), undone: both(before) });
  });

  test('Cmd+Shift+Up on a toggle child reorders it on screen, not only in the saved data', async ({ page }) => {
    await createBlok(page, [toggle('t', ['c1', 'c2']), paragraph('c1', 't'), paragraph('c2', 't'), paragraph('b')]);
    await gap(page);
    const before = await save(page);

    await pressOn(page, 'c2', MOVE_UP);

    expect(await afterAndUndo(page)).toEqual({ after: both([
      { id: 't', parent: null },
      { id: 'c2', parent: 't' },
      { id: 'c1', parent: 't' },
      { id: 'b', parent: null },
    ]), undone: both(before) });
  });

  test('Cmd+Shift+Down on a callout child steps over a toggle with a child inside the callout', async ({ page }) => {
    await createBlok(page, [
      { id: 'co', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
      paragraph('k1', 'co'),
      toggle('k2', ['kk'], { parent: 'co' }),
      paragraph('kk', 'k2'),
      paragraph('b'),
    ]);
    await gap(page);
    const before = await save(page);

    await pressOn(page, 'k1', MOVE_DOWN);

    expect(await afterAndUndo(page)).toEqual({ after: both([
      { id: 'co', parent: null },
      { id: 'k2', parent: 'co' },
      { id: 'kk', parent: 'k2' },
      { id: 'k1', parent: 'co' },
      { id: 'b', parent: null },
    ]), undone: both(before) });
  });

  test('Alt-drag of a toggle with a child keeps the copied child inside the copy', async ({ page }) => {
    await createBlok(page, [toggle('t', ['tc']), paragraph('tc', 't'), paragraph('b')]);

    await dragByHandle(page, 't', async () => {
      const target = await boxOf(page, '[data-blok-id="b"] [data-blok-element-content]');

      return target.y + target.height * 0.8;
    }, true);

    await expect.poll(async () => (await save(page)).length).toBe(5);

    const saved = await save(page);
    const [copy, copiedChild] = saved.slice(3);

    expect(saved.slice(0, 3)).toEqual([
      { id: 't', parent: null },
      { id: 'tc', parent: 't' },
      { id: 'b', parent: null },
    ]);
    expect(copy.parent).toBeNull();
    expect(copiedChild.parent).toBe(copy.id);
    expect(await screen(page)).toEqual(saved);
  });

  test('dragging a toggle child to the top of the document shows it first', async ({ page }) => {
    await createBlok(page, [paragraph('a'), toggle('t', ['c1', 'tc']), paragraph('c1', 't'), paragraph('tc', 't'), paragraph('b')]);

    await dragByHandle(page, 'tc', async () => {
      const target = await boxOf(page, '[data-blok-id="a"] [data-blok-element-content]');

      return target.y + 3;
    });

    const expected = [
      { id: 'tc', parent: null },
      { id: 'a', parent: null },
      { id: 't', parent: null },
      { id: 'c1', parent: 't' },
      { id: 'b', parent: null },
    ];

    await expect.poll(async () => await save(page)).toEqual(expected);
    expect(await screen(page)).toEqual(expected);
  });

  test('blocks.move into a toggle\'s first-child slot nests the block, and undo takes it back out', async ({ page }) => {
    await createBlok(page, [paragraph('a'), toggle('t', ['tc']), paragraph('tc', 't'), paragraph('b')]);
    await gap(page);
    const before = await save(page);

    await page.evaluate(() => {
      window.blokInstance?.blocks.move(1, 0);
    });

    expect(await afterAndUndo(page, true)).toEqual({ after: both([
      { id: 't', parent: null },
      { id: 'a', parent: 't' },
      { id: 'tc', parent: 't' },
      { id: 'b', parent: null },
    ]), undone: both(before) });
  });
});
