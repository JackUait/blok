import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Keyboard and menu paths on a toggle that has children: the slash menu or
 * Backspace replacing it, and Enter at the start of its title. Each test checks
 * that the saved tree, the on-screen tree and the flat order agree.
 */

const HOLDER_ID = 'blok';

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

const toggle = (id: string, content: string[], text: string, isOpen = true, parent?: string): BlockData => ({
  id,
  type: 'toggle',
  data: { text, isOpen },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

const toggleHeading = (id: string, content: string[], text: string, isOpen = true, parent?: string): BlockData => ({
  id,
  type: 'header',
  data: { text, level: 2, isToggleable: true, isOpen },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

const paragraph = (id: string, text: string, parent?: string): BlockData => ({
  id,
  type: 'paragraph',
  data: { text },
  ...(parent !== undefined ? { parent } : {}),
});

const callout = (id: string, content: string[]): BlockData => ({
  id,
  type: 'callout',
  data: { emoji: '💡', textColor: null, backgroundColor: null },
  content,
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

/**
 * Each block and the block it sits under on screen, in document order. A block
 * with no child slot (text, plain heading) keeps its children flat right after
 * it, one indent step deeper; a slot owner (toggle, callout) encloses them.
 */
const screen = async (page: Page): Promise<Row[]> =>
  await page.evaluate((holder) => {
    const depthOf = (element: Element): number => Number(element.getAttribute('data-blok-depth') ?? '0');

    return Array.from(
      document.querySelectorAll(`#${holder} [data-blok-testid="block-wrapper"]`)
    ).map(element => {
      const depth = depthOf(element);
      const siblings = Array.from(element.parentElement?.children ?? []);
      const shallower = siblings
        .slice(0, siblings.indexOf(element))
        .reverse()
        .find(sibling => sibling.matches('[data-blok-testid="block-wrapper"]') && depthOf(sibling) < depth);
      const flatParent = shallower !== undefined && depthOf(shallower) === depth - 1 ? shallower : null;
      const parent = flatParent ?? element.parentElement?.closest('[data-blok-testid="block-wrapper"]');

      return { id: element.getAttribute('data-blok-id') ?? '', parent: parent?.getAttribute('data-blok-id') ?? null };
    });
  }, HOLDER_ID);

/** Each block and its parent in the editor's flat order. */
const flat = async (page: Page): Promise<Row[]> =>
  await page.evaluate(() => {
    const blocks = window.blokInstance?.blocks;
    const count = blocks?.getBlocksCount() ?? 0;

    return Array.from({ length: count }, (_, index) => {
      const block = blocks?.getBlockByIndex(index);

      return { id: block?.id ?? '', parent: block?.parentId ?? null };
    });
  });

/** The title editable of a block. Its own editable comes before any child's. */
const titleOf = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Put the caret at the very start of a block's title. */
const caretAtStart = async (page: Page, id: string): Promise<void> => {
  await titleOf(page, id).click();
  await page.keyboard.press('Home');
};

const pickFromSlashMenu = async (page: Page, itemName: string): Promise<void> => {
  await page.keyboard.type('/');
  await page.getByTestId('toolbox-popover')
    .locator(`[data-blok-testid="popover-item"][data-blok-item-name="${itemName}"]`)
    .click();
};

const row = (id: string, parent: string | null = null): Row => ({ id, parent });

test.describe('toggle with children: replace and Enter paths', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('slash menu on an empty toggle title keeps the child nested under the new heading', async ({ page }) => {
    await createBlok(page, [toggle('t', ['c'], ''), paragraph('c', 'child', 't'), paragraph('z', 'after')]);

    await caretAtStart(page, 't');
    await pickFromSlashMenu(page, 'header-2');

    await expect.poll(async () => (await flat(page)).map(entry => entry.id).includes('t')).toBe(false);

    const rows = await flat(page);
    const heading = rows[0].id;
    const expected = [row(heading), row('c', heading), row('z')];

    expect(rows).toEqual(expected);
    expect(await screen(page)).toEqual(expected);
    expect(await save(page)).toEqual(expected);
  });

  test('slash menu on an empty toggle heading inside a callout moves its child into the callout', async ({ page }) => {
    await createBlok(page, [
      callout('C', ['h', 'Q']),
      toggleHeading('h', ['c'], '', true, 'C'),
      paragraph('c', 'child', 'h'),
      paragraph('Q', 'last', 'C'),
    ]);

    await caretAtStart(page, 'h');
    await pickFromSlashMenu(page, 'header-2');

    await expect.poll(async () => (await flat(page)).map(entry => entry.id).includes('h')).toBe(false);

    const rows = await flat(page);
    const heading = rows[1].id;
    const expected = [row('C'), row(heading, 'C'), row('c', 'C'), row('Q', 'C')];

    expect(rows).toEqual(expected);
    expect(await screen(page)).toEqual(expected);
    expect(await save(page)).toEqual(expected);
  });

  test('Backspace on an empty toggle title keeps the child nested under the new text block', async ({ page }) => {
    await createBlok(page, [toggle('t', ['c'], ''), paragraph('c', 'child', 't'), paragraph('z', 'after')]);

    await caretAtStart(page, 't');
    await page.keyboard.press('Backspace');

    await expect.poll(async () => await page.evaluate(() => window.blokInstance?.blocks.getById('t')?.name)).toBe('paragraph');

    const expected = [row('t'), row('c', 't'), row('z')];

    expect(await flat(page)).toEqual(expected);
    expect(await screen(page)).toEqual(expected);
    expect(await save(page)).toEqual(expected);
  });

  test('Backspace on an empty toggle heading inside a callout keeps its child in the callout', async ({ page }) => {
    await createBlok(page, [
      callout('C', ['S', 'Q']),
      toggleHeading('S', ['K'], '', true, 'C'),
      paragraph('K', 'kid', 'S'),
      paragraph('Q', 'last', 'C'),
    ]);

    await caretAtStart(page, 'S');
    await page.keyboard.press('Backspace');

    const expected = [row('C'), row('S', 'C'), row('K', 'C'), row('Q', 'C')];

    await expect.poll(async () => await flat(page)).toEqual(expected);
    expect(await screen(page)).toEqual(expected);
    expect(await save(page)).toEqual(expected);
  });

  for (const [kind, make] of [['toggle list', toggle], ['toggle heading', toggleHeading]] as const) {
    for (const isOpen of [true, false]) {
      test(`Enter at the start of a ${isOpen ? 'open' : 'collapsed'} ${kind} title adds an empty block above`, async ({ page }) => {
        await createBlok(page, [
          paragraph('a', 'before'),
          make('t', ['c'], 'title', isOpen),
          paragraph('c', 'child', 't'),
          paragraph('z', 'after'),
        ]);

        await caretAtStart(page, 't');
        await page.keyboard.press('Enter');

        await expect.poll(async () => (await flat(page)).length).toBe(5);

        const rows = await flat(page);
        const added = rows[1].id;
        const expected = [row('a'), row(added), row('t'), row('c', 't'), row('z')];

        expect(rows).toEqual(expected);
        expect(await screen(page)).toEqual(expected);

        // The caret stayed at the start of the title.
        await page.keyboard.type('X');
        await expect(titleOf(page, 't')).toHaveText('Xtitle');

        // Blank text blocks are kept on save.
        expect(await save(page)).toEqual(expected);
      });
    }
  }
});
