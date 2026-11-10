import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const create = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: [{ type: 'paragraph', data: { text: 'Alpha' } }] } });

    window.blokInstance = blok;
    await blok.isReady;
    blok.history.clear();
  }, { holder: HOLDER_ID });
};

type SavedBlock = { id: string; type: string; data: Record<string, unknown>; parent?: string; content?: string[] };

const createWith = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await page.evaluate(async ({ holder, initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
    blok.history.clear();
  }, { holder: HOLDER_ID, initial: blocks });
};

const P = (id: string, text: string, parent?: string): SavedBlock =>
  parent === undefined ? { id, type: 'paragraph', data: { text } } : { id, type: 'paragraph', data: { text }, parent };

const editableOf = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Select blocks through the blockSelection module, as gestures.spec does. */
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

const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

const tune = (page: Page, name: string): Locator =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

/** Open the block menu from the handle of block `id`; with blocks already selected, the menu is theirs. */
const openTunes = async (page: Page, id: string): Promise<void> => {
  await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().hover();
  await page.locator(HANDLE).click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();
};

const turnInto = async (page: Page, id: string, to: string): Promise<void> => {
  await openTunes(page, id);
  await tune(page, 'convert-to').click();
  await page.locator(NESTED_POPOVER).getByRole('menuitem', { name: to, exact: true }).click();
};

const savedBlocks = async (page: Page): Promise<string[]> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

  return blocksAsHtml(blocks).map((block) => {
    const text: unknown = block.data.text;

    return `${block.type}:${typeof text === 'string' ? text : ''}`;
  });
};

const savedText = async (page: Page): Promise<string> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);
  const text: unknown = blocksAsHtml(blocks)[0]?.data.text;

  return typeof text === 'string' ? text : '';
};

test.describe('undo audit — undo and redo announcements', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await create(page);
  });

  test('a key press says Undone, Redone, then Nothing to redo', async ({ page }) => {
    // The live region Blok owns, not any other status region on the page.
    const status = page.locator('[data-blok-announcer][role="status"]');
    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.press('End');
    // One letter, no space: a space plus a pause would cut a second step.
    await page.keyboard.type('X');
    await expect.poll(() => savedText(page)).toBe('AlphaX');

    // The region clears 1 s after each message, so check right after each press.
    await page.keyboard.press(UNDO);
    await expect(status).toHaveText('Undone');
    await expect.poll(() => savedText(page)).toBe('Alpha');

    await page.keyboard.press(REDO);
    await expect(status).toHaveText('Redone');
    await expect.poll(() => savedText(page)).toBe('AlphaX');

    // If an announcement had made a step, this redo would have something to apply.
    await page.keyboard.press(REDO);
    await expect(status).toHaveText('Nothing to redo');
    await expect.poll(() => savedText(page)).toBe('AlphaX');
  });

  // Notion RM8 / U003: an empty undo with the caret in the page says so.
  test('an undo press with nothing to undo says Nothing to undo', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');
    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.press(UNDO);

    await expect(status).toHaveText('Nothing to undo');
    await expect.poll(() => savedText(page)).toBe('Alpha');
  });

  // Notion U121: with blocks block-selected an empty undo says nothing.
  test('an empty undo with blocks selected says nothing', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta')]);
    await editableOf(page, 'a').click();
    await selectBlocks(page, ['a', 'b']);
    await page.keyboard.press(UNDO);
    // Give the announcer's next-task write time to land before reading the region.
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.setTimeout(resolve, 200);
    }));

    await expect(status).toHaveText('');
  });

  // Notion U084 / U086: Turn into says what the block became.
  test('Turn into from the block menu says Converted to Heading 1', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [P('a', 'Above'), P('b', 'Text body')]);
    await turnInto(page, 'b', 'Heading 1');

    await expect(status).toHaveText('Converted to Heading 1');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Above', 'header:Text body']);
  });

  // Notion U123: a multi-block Turn into counts the blocks.
  test('Turn into on two selected blocks says 2 blocks converted to Heading 2', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [P('a', 'one'), P('b', 'two')]);
    await selectBlocks(page, ['a', 'b']);
    await turnInto(page, 'a', 'Heading 2');

    await expect(status).toHaveText('2 blocks converted to Heading 2');
    await expect.poll(() => savedBlocks(page)).toEqual(['header:one', 'header:two']);
  });

  // Notion U095: Enter on an empty bullet turns it into text in place.
  test('Enter on an empty bullet says Converted to Text', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [
      { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' } },
      { id: 'l2', type: 'list', data: { text: '', style: 'unordered' } },
    ]);
    await editableOf(page, 'l2').click();
    await page.keyboard.press('Enter');

    await expect(status).toHaveText('Converted to Text');
    await expect.poll(() => savedBlocks(page)).toEqual(['list:one', 'paragraph:']);
  });

  // Notion U099 / U144: Backspace at the start of a top-level item turns it into text.
  test('Backspace at the start of a numbered item says Converted to Text', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [
      { id: 'l1', type: 'list', data: { text: 'one', style: 'ordered' } },
      { id: 'l2', type: 'list', data: { text: 'two', style: 'ordered' } },
    ]);
    await editableOf(page, 'l2').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');

    await expect(status).toHaveText('Converted to Text');
    await expect.poll(() => savedBlocks(page)).toEqual(['list:one', 'paragraph:two']);
  });

  // Notion U106 / U047: deleting a selected block counts it.
  test('Backspace on a selected block says 1 block deleted', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta'), P('c', 'Gamma')]);
    await editableOf(page, 'b').click();
    await selectBlocks(page, ['b']);
    await page.keyboard.press('Backspace');

    await expect(status).toHaveText('1 block deleted');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Alpha', 'paragraph:Gamma']);
  });

  test('Delete on two selected blocks says 2 blocks deleted', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta'), P('c', 'Gamma')]);
    await editableOf(page, 'a').click();
    await selectBlocks(page, ['a', 'b']);
    await page.keyboard.press('Delete');

    await expect(status).toHaveText('2 blocks deleted');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Gamma']);
  });

  // Notion U135: a toggle's children are not counted.
  test('deleting a selected toggle with two children says 1 block deleted', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [
      P('a', 'Alpha'),
      { id: 'tg', type: 'toggle', data: { text: 'Tog', isOpen: true }, content: ['k1', 'k2'] },
      P('k1', 'kid one', 'tg'),
      P('k2', 'kid two', 'tg'),
    ]);
    await editableOf(page, 'a').click();
    await selectBlocks(page, ['tg']);
    await page.keyboard.press('Backspace');

    await expect(status).toHaveText('1 block deleted');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Alpha']);
  });

  // Notion U104: Delete from the block menu.
  test('Delete from the block menu says 1 block deleted', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta')]);
    await openTunes(page, 'b');
    await tune(page, 'delete').click();

    await expect(status).toHaveText('1 block deleted');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Alpha']);
  });

  test('Delete from the block menu of two selected blocks says 2 blocks deleted', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');

    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta'), P('c', 'Gamma')]);
    await selectBlocks(page, ['a', 'b']);
    await openTunes(page, 'a');
    // A pointer click on this item deletes nothing (an existing bug outside this test), so use the keyboard.
    const deleteItem = tune(page, 'delete');

    while (await deleteItem.getAttribute('data-blok-focused') === null) {
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Enter');

    await expect(status).toHaveText('2 blocks deleted');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Gamma']);
  });

  // Notion's live region after a markdown shortcut (scenarios U074, U077, U080, U083).
  for (const { keys, message, blocks } of [
    { keys: '## ', message: 'Converted to Heading 2', blocks: ['paragraph:Alpha', 'header:Item'] },
    { keys: '[] ', message: 'Converted to To-do list', blocks: ['paragraph:Alpha', 'list:Item'] },
    { keys: '---', message: 'Converted to Divider', blocks: ['paragraph:Alpha', 'divider:', 'paragraph:Item'] },
    { keys: '# ', message: 'Converted to Heading 1', blocks: ['paragraph:Alpha', 'header:Item'] },
  ]) {
    test(`typing ${JSON.stringify(keys)} says ${message}`, async ({ page }) => {
      const status = page.locator('[data-blok-announcer][role="status"]');
      const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

      await editable.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      // The region clears 1 s after each message, so check right after the shortcut.
      await page.keyboard.type(keys);
      await expect(status).toHaveText(message);

      await page.keyboard.type('Item');
      await expect.poll(() => savedBlocks(page)).toEqual(blocks);
    });
  }

  test('an undo after a shortcut says only Undone and keeps the steps', async ({ page }) => {
    const status = page.locator('[data-blok-announcer][role="status"]');
    const editable = page.locator(`#${HOLDER_ID} [contenteditable="true"]`).first();

    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## ');
    await expect(status).toHaveText('Converted to Heading 2');
    await page.keyboard.type('Item');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Alpha', 'header:Item']);

    // The first undo takes back only the text typed after the conversion, as in Notion.
    await page.keyboard.press(UNDO);
    await expect(status).toHaveText('Undone');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:Alpha', 'header:']);
  });
});
