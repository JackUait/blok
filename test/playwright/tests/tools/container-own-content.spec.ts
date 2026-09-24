import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * A container's holder holds its children's holders, and a toggle keeps its
 * body placeholder and arrow in the DOM at all times. These specs pin the
 * user-visible cases where Blok read that chrome, or a child, as the block's
 * own content.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const createBlok = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ holder, initialBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: initialBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks });
};

/** `id:type:parent` for every saved block, in saved order. */
const savedTree = async (page: Page): Promise<string[]> =>
  await page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map((block) => `${block.id}:${block.type}:${block.parent ?? 'root'}`);
  });

const savedTypes = async (page: Page): Promise<string[]> =>
  await page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map((block) => `${block.type}:${block.parent === undefined ? 'root' : 'child'}`);
  });

const editableOf = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/** Open the toolbox from the plus button of the hovered block and pick "Heading 2". */
const insertHeadingWithPlusButton = async (page: Page, id: string): Promise<void> => {
  await editableOf(page, id).click();
  await editableOf(page, id).hover();
  await page.getByTestId('plus-button').click();
  await page.keyboard.type('Heading 2');
  await page.keyboard.press('Enter');
};

test.describe('containers read their own content, not chrome or children', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('one Cmd+A in an empty toggle title selects the toggle block, as in an empty heading', async ({ page }) => {
    await createBlok(page, [
      { id: 'T', type: 'toggle', data: { text: '' } },
      { id: 'P', type: 'paragraph', data: { text: 'after' } },
    ]);

    await editableOf(page, 'T').click();
    await page.keyboard.press('ControlOrMeta+a');

    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[data-blok-id="T"]')).toHaveAttribute('data-blok-selected', 'true');
  });

  test('one Cmd+A in an empty toggle heading selects the block', async ({ page }) => {
    await createBlok(page, [
      { id: 'H', type: 'header', data: { text: '', level: 2, isToggleable: true } },
      { id: 'P', type: 'paragraph', data: { text: 'after' } },
    ]);

    await editableOf(page, 'H').click();
    await page.keyboard.press('ControlOrMeta+a');

    await expect(page.locator('[data-blok-id="H"]')).toHaveAttribute('data-blok-selected', 'true');
  });

  test('the plus button on an empty toggle reuses it, as it does an empty paragraph', async ({ page }) => {
    await createBlok(page, [
      { id: 'P', type: 'paragraph', data: { text: 'above' } },
      { id: 'T', type: 'toggle', data: { text: '' } },
    ]);

    await insertHeadingWithPlusButton(page, 'T');

    await expect.poll(() => savedTypes(page)).toEqual(['paragraph:root', 'header:root']);
  });

  test('the plus button on an empty-titled toggle with a child keeps the toggle and its child', async ({ page }) => {
    await createBlok(page, [
      { id: 'P', type: 'paragraph', data: { text: 'above' } },
      { id: 'T', type: 'toggle', data: { text: '', isOpen: true }, content: ['K'] },
      { id: 'K', type: 'paragraph', data: { text: '' }, parent: 'T' },
    ]);

    await insertHeadingWithPlusButton(page, 'T');

    await expect.poll(async () => (await savedTree(page)).slice(0, 3)).toEqual([
      'P:paragraph:root',
      'T:toggle:root',
      'K:paragraph:T',
    ]);
  });

  test('a toggle whose only child is an empty toggle shows the empty arrow state', async ({ page }) => {
    await createBlok(page, [
      { id: 'A', type: 'toggle', data: { text: 'outer', isOpen: true }, content: ['B'] },
      { id: 'B', type: 'toggle', data: { text: '' }, parent: 'A' },
    ]);

    const ownEmptyState = await page.evaluate(() => {
      const holder = document.querySelector('[data-blok-id="A"]');
      const wrapper = Array.from(holder?.querySelectorAll('[data-blok-toggle-empty]') ?? [])
        .find((element) => element.closest('[data-blok-id]') === holder);

      return wrapper?.getAttribute('data-blok-toggle-empty');
    });

    expect(ownEmptyState).toBe('true');
  });

  test('Backspace on a callout\'s empty toggle-heading first line turns it into a plain heading and keeps the rest', async ({ page }) => {
    await createBlok(page, [
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'Q'] },
      { id: 'S', type: 'header', data: { text: '', level: 2, isToggleable: true }, parent: 'C' },
      { id: 'Q', type: 'paragraph', data: { text: 'q' }, parent: 'C' },
    ]);

    await editableOf(page, 'S').click();
    await page.keyboard.press('Backspace');

    await expect.poll(() => savedTree(page)).toEqual(['C:callout:root', 'S:header:C', 'Q:paragraph:C']);
  });

  test('Backspace in an empty block nested in a callout\'s first line leaves that first line alone', async ({ page }) => {
    await createBlok(page, [
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'Q'] },
      { id: 'S', type: 'toggle', data: { text: 'title', isOpen: true }, parent: 'C', content: ['K'] },
      { id: 'K', type: 'paragraph', data: { text: '' }, parent: 'S' },
      { id: 'Q', type: 'paragraph', data: { text: 'q' }, parent: 'C' },
    ]);

    await editableOf(page, 'K').click();
    await page.keyboard.press('Backspace');

    await expect.poll(async () => (await savedTree(page)).slice(0, 2)).toEqual(['C:callout:root', 'S:toggle:C']);
  });
});
