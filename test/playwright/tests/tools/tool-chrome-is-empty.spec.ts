import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * A list marker, a checkbox and a code block's header and line numbers sit in
 * the DOM next to the user's text. These specs pin the cases where Blok read
 * that UI as content: an empty list item or code block must act like an empty
 * paragraph, and a copied code block must not carry its header text.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
    lastCopiedHtml?: string;
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

const savedTypes = async (page: Page): Promise<string[]> =>
  await page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map((block) => block.type);
  });

const editableOf = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"], [data-blok-id="${id}"] [contenteditable="plaintext-only"]`).first();

const EMPTY_BLOCKS: Array<{ name: string; block: OutputBlockData }> = [
  { name: 'bullet list item', block: { id: 'X', type: 'list', data: { text: '', style: 'unordered' } } },
  { name: 'numbered list item', block: { id: 'X', type: 'list', data: { text: '', style: 'ordered' } } },
  { name: 'checklist item', block: { id: 'X', type: 'list', data: { text: '', style: 'checklist', checked: false } } },
  { name: 'code block', block: { id: 'X', type: 'code', data: { code: '', language: 'plain text' } } },
];

test.describe('tool chrome is not content', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  for (const { name, block } of EMPTY_BLOCKS) {
    test(`one Cmd+A in an empty ${name} selects the block, as in an empty paragraph`, async ({ page }) => {
      await createBlok(page, [
        block,
        { id: 'P', type: 'paragraph', data: { text: 'after' } },
      ]);

      await editableOf(page, 'X').click();
      await page.keyboard.press('ControlOrMeta+a');

      await expect(page.locator('[data-blok-id="X"]')).toHaveAttribute('data-blok-selected', 'true');
    });

    test(`the plus button on an empty ${name} reuses it instead of adding a block below`, async ({ page }) => {
      await createBlok(page, [
        { id: 'P', type: 'paragraph', data: { text: 'above' } },
        block,
      ]);

      await editableOf(page, 'X').click();
      await editableOf(page, 'X').hover();
      await page.getByTestId('plus-button').click();
      await page.keyboard.type('Heading 2');
      await page.keyboard.press('Enter');

      await expect.poll(() => savedTypes(page)).toEqual(['paragraph', 'header']);
    });
  }

  test('a copied code block carries its code, not its language label or line numbers', async ({ page }) => {
    await createBlok(page, [
      { id: 'P', type: 'paragraph', data: { text: 'before' } },
      { id: 'X', type: 'code', data: { code: 'abc', language: 'plain text' } },
    ]);
    await page.evaluate(() => {
      document.addEventListener('copy', (event) => {
        window.lastCopiedHtml = event.clipboardData?.getData('text/html');
      });
    });

    await editableOf(page, 'X').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator('[data-blok-id="X"]')).toHaveAttribute('data-blok-selected', 'true');
    await page.keyboard.press('ControlOrMeta+c');

    await expect.poll(() => page.evaluate(() => window.lastCopiedHtml)).toBe('<pre><code>abc</code></pre>');
  });
});
