import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Backspace in a callout whose only line is empty turns the callout into an
 * empty text line, like Notion.
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

/** `type:text:parent` of every saved block. */
const savedBlocks = async (page: Page): Promise<string[]> =>
  await page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map((block) => `${block.type}:${String(block.data.text)}:${block.parent ?? 'root'}`);
  });

test.describe('callout: Backspace in an empty only line', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('turns the callout into an empty paragraph that keeps the caret', async ({ page }) => {
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'before' } },
      { id: 'c', type: 'callout', data: { emoji: '' }, content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: '' }, parent: 'c' },
    ]);

    await page.locator('[data-blok-id="p"] [contenteditable="true"]').first().click();
    await page.keyboard.press('Backspace');

    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:before:root', 'paragraph::root']);

    await page.keyboard.type('x');

    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:before:root', 'paragraph:x:root']);
  });

  test('one undo brings the callout back', async ({ page }) => {
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'before' } },
      { id: 'c', type: 'callout', data: { emoji: '' }, content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: '' }, parent: 'c' },
    ]);

    await page.locator('[data-blok-id="p"] [contenteditable="true"]').first().click();
    await page.keyboard.press('Backspace');
    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:before:root', 'paragraph::root']);

    await page.keyboard.press('ControlOrMeta+z');

    await expect.poll(() => savedBlocks(page)).toEqual(['paragraph:before:root', 'callout:undefined:root', 'paragraph::c']);
  });

  // Core handles this; the callout used to have its own handler for it.
  test('removes an empty heading first line and keeps the lines after it', async ({ page }) => {
    await createBlok(page, [
      { id: 'c', type: 'callout', data: { emoji: '' }, content: ['h', 'q'] },
      { id: 'h', type: 'header', data: { text: '', level: 2 }, parent: 'c' },
      { id: 'q', type: 'paragraph', data: { text: 'q' }, parent: 'c' },
    ]);

    await page.locator('[data-blok-id="h"] [contenteditable="true"]').first().click();
    await page.keyboard.press('Backspace');

    await expect.poll(() => savedBlocks(page)).toEqual(['callout:undefined:root', 'paragraph:q:c']);
  });
});
