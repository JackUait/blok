import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Public paths that used to break tree order: a block drawn inside a container
 * the saved tree says it is outside of, or a flat order that skips a subtree.
 * Each test checks the saved tree and the on-screen tree agree.
 */

const HOLDER_ID = 'blok';
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';

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

const toggle = (id: string, content: string[], parent?: string, isOpen = true): BlockData => ({
  id,
  type: 'toggle',
  data: { text: `Toggle ${id}`, isOpen },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

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

/** Block ids in the editor's flat order (what ArrowDown walks). */
const flatIds = async (page: Page): Promise<string[]> =>
  await page.evaluate(() => {
    const blocks = window.blokInstance?.blocks;
    const count = blocks?.getBlocksCount() ?? 0;

    return Array.from({ length: count }, (_, index) => blocks?.getBlockByIndex(index)?.id ?? '');
  });

interface Tree {
  saved: Row[];
  screen: Row[];
  flat: string[];
}

const tree = async (page: Page): Promise<Tree> => ({
  saved: await save(page),
  screen: await screen(page),
  flat: await flatIds(page),
});

/** Saved tree, on-screen tree and flat order all agree with `rows`. */
const agreeing = (rows: Row[]): Tree => ({ saved: rows, screen: rows, flat: rows.map(entry => entry.id) });

const row = (id: string, parent: string | null = null): Row => ({ id, parent });

test.describe('tree order on public paths', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('blocks.insert between two toggle children lands inside the toggle', async ({ page }) => {
    await createBlok(page, [toggle('t', ['c1', 'c2']), paragraph('c1', 't'), paragraph('c2', 't'), paragraph('z')]);

    await page.evaluate(() => {
      window.blokInstance?.blocks.insert('paragraph', { text: 'new' }, undefined, 2, false, false, 'new');
    });

    expect(await tree(page)).toEqual(agreeing([row('t'), row('c1', 't'), row('new', 't'), row('c2', 't'), row('z')]));
  });

  test('blocks.insert right after a toggle with children becomes its first child', async ({ page }) => {
    await createBlok(page, [toggle('t', ['c1']), paragraph('c1', 't'), paragraph('z')]);

    await page.evaluate(() => {
      window.blokInstance?.blocks.insert('paragraph', { text: 'new' }, undefined, 1, false, false, 'new');
    });

    expect(await tree(page)).toEqual(agreeing([row('t'), row('new', 't'), row('c1', 't'), row('z')]));
  });

  test('blocks.insert after the last toggle child at the end of the document lands at the root', async ({ page }) => {
    await createBlok(page, [paragraph('a'), toggle('t', ['c1']), paragraph('c1', 't')]);

    await page.evaluate(() => {
      window.blokInstance?.blocks.insert('paragraph', { text: 'new' }, undefined, 3, false, false, 'new');
    });

    expect(await tree(page)).toEqual(agreeing([row('a'), row('t'), row('c1', 't'), row('new')]));
  });

  test('Enter at the end of a collapsed toggle heading that ends the document adds a visible root block', async ({ page }) => {
    await createBlok(page, [
      paragraph('a'),
      { id: 'h', type: 'header', data: { text: 'Heading', level: 2, isToggleable: true, isOpen: false }, content: ['hc'] },
      paragraph('hc', 'h'),
    ]);

    const title = page.locator('[data-blok-id="h"] [contenteditable="true"]').first();

    await title.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('after');

    const saved = await save(page);

    expect(saved.map(block => block.parent)).toEqual([null, null, 'h', null]);
    expect(await screen(page)).toEqual(saved);
    await expect(page.getByText('after')).toBeVisible();
  });

  test('blocks.insert after a toggle child inside a column stays in that column', async ({ page }) => {
    await createBlok(page, [
      { id: 'cl', type: 'column_list', data: {}, content: ['col1', 'col2'] },
      { id: 'col1', type: 'column', data: {}, parent: 'cl', content: ['t'] },
      toggle('t', ['c1'], 'col1'),
      paragraph('c1', 't'),
      { id: 'col2', type: 'column', data: {}, parent: 'cl', content: ['c2p'] },
      paragraph('c2p', 'col2'),
      paragraph('z'),
    ]);

    await page.evaluate(() => {
      window.blokInstance?.blocks.insert('paragraph', { text: 'new' }, undefined, 4, false, false, 'new');
    });

    expect(await tree(page)).toEqual(agreeing([
      row('cl'), row('col1', 'cl'), row('t', 'col1'), row('c1', 't'), row('new', 'col1'),
      row('col2', 'cl'), row('c2p', 'col2'), row('z'),
    ]));
  });

  test('blocks.move of a grandchild to index 0 puts it at the root', async ({ page }) => {
    await createBlok(page, [toggle('t', ['u']), toggle('u', ['u1'], 't'), paragraph('u1', 'u'), paragraph('z')]);

    await page.evaluate(() => {
      window.blokInstance?.blocks.move(0, 2);
    });

    expect(await tree(page)).toEqual(agreeing([row('u1'), row('t'), row('u', 't'), row('z')]));
  });

  test('blocks.setBlockParent on a block above the toggle appends it to the toggle', async ({ page }) => {
    await createBlok(page, [paragraph('b'), toggle('t', ['c1']), paragraph('c1', 't'), paragraph('z')]);

    await page.evaluate(() => {
      window.blokInstance?.blocks.setBlockParent('b', 't');
    });

    expect(await tree(page)).toEqual(agreeing([row('t'), row('c1', 't'), row('b', 't'), row('z')]));
  });

  test('dropping a block beside another keeps the block between them out of the columns', async ({ page }) => {
    await createBlok(page, [paragraph('a'), paragraph('m'), paragraph('b')]);

    const source = page.locator('[data-blok-id="b"]').first();
    const sourceBox = await source.boundingBox();

    if (sourceBox === null) {
      throw new Error('missing bounding box for b');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);

    const handle = page.locator(HANDLE);

    await expect(handle).toBeVisible();

    const handleBox = await handle.boundingBox();
    const targetBox = await page.locator('[data-blok-id="a"] [data-blok-element-content]').first().boundingBox();

    if (handleBox === null || targetBox === null) {
      throw new Error('missing bounding box for side drop');
    }

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width - 4, targetBox.y + targetBox.height / 2, { steps: 15 });
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true'
    );
    await page.mouse.up();

    await expect.poll(async () => (await save(page)).length).toBe(6);

    const saved = await save(page);
    const [list, first, , second] = saved.map(block => block.id);

    expect(saved).toEqual([
      row(list), row(first, list), row('a', first), row(second, list), row('b', second), row('m'),
    ]);
    expect(await screen(page)).toEqual(saved);
    expect(await flatIds(page)).toEqual(saved.map(block => block.id));
  });

  test('a stored document with a child before its parent loads in tree order', async ({ page }) => {
    await createBlok(page, [paragraph('c1', 't'), toggle('t', ['c1']), paragraph('z')]);

    expect(await tree(page)).toEqual(agreeing([row('t'), row('c1', 't'), row('z')]));

    await page.locator('[data-blok-id="t"] [contenteditable="true"]').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');

    const focused = await page.evaluate(() => document.activeElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id'));

    expect(focused).toBe('c1');
  });

  test('blocks.insertInsideParent at the parent index puts the child after the parent', async ({ page }) => {
    await createBlok(page, [paragraph('a'), toggle('t', ['c1']), paragraph('c1', 't'), paragraph('z')]);

    await page.evaluate(() => {
      window.blokInstance?.blocks.insertInsideParent('t', 1, { text: 'new' }, undefined, { id: 'new' });
    });

    expect(await tree(page)).toEqual(agreeing([row('a'), row('t'), row('new', 't'), row('c1', 't'), row('z')]));
  });
});
