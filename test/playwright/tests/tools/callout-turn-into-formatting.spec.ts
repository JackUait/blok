import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Turning text into a callout moves it into the callout's first child
 * paragraph. Line breaks and bold must come along.
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

/** `type:text` of every block saved inside a callout. */
const savedCalloutBody = async (page: Page): Promise<string[]> =>
  await page.evaluate(async () => {
    const saved = await window.blokInstance?.save();
    const blocks = saved?.blocks ?? [];
    const calloutIds = new Set(blocks.filter((block) => block.type === 'callout').map((block) => block.id));

    return blocks
      .filter((block) => block.parent !== undefined && calloutIds.has(block.parent))
      .map((block) => `${block.type}:${String(block.data.text)}`);
  });

test.describe('callout: turn into keeps line breaks and bold', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('typing /callout after formatted text keeps its line break and bold', async ({ page }) => {
    await createBlok(page, [
      { id: 'p', type: 'paragraph', data: { text: 'Line one<br>Line <b>bold</b> two' } },
    ]);

    const editable = page.locator('[data-blok-id="p"] [contenteditable="true"]').first();

    await editable.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('/callout');
    await page.keyboard.press('Enter');

    // Blok stores bold as <strong> once the text has been through the editable.
    await expect.poll(() => savedCalloutBody(page)).toEqual(['paragraph:Line one<br>Line <strong>bold</strong> two']);
  });
});
