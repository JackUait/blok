import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * A callout's block menu offers "Turn into" (Notion). Its first line becomes
 * the new block's text; the other lines follow, formatting intact. One undo
 * brings the callout back.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const CALLOUT_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="callout"]`;
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION = `${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`;
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

const FIRST = 'One <strong>bold</strong><br>two <a href="https://example.com">link</a>';
const SECOND = 'Second <i>line</i>';

const BLOCKS: OutputBlockData[] = [
  { id: 'before', type: 'paragraph', data: { text: 'before' } },
  { id: 'C', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['c1', 'c2'] },
  { id: 'c1', type: 'paragraph', data: { text: FIRST }, parent: 'C' },
  { id: 'c2', type: 'paragraph', data: { text: SECOND }, parent: 'C' },
  { id: 'after', type: 'paragraph', data: { text: 'after' } },
];

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder, blocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks: BLOCKS });
};

/** Every saved block as `id:type:parent` plus its text. */
const savedBlocks = async (page: Page): Promise<string[]> =>
  await page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map((block) =>
      `${String(block.id)}:${block.type}:${block.parent ?? 'root'}:${String(block.data.text)}`);
  });

const turnCalloutInto = async (page: Page, title: string, caretIn = 'c2'): Promise<void> => {
  await page.locator(`[data-blok-id="${caretIn}"] [contenteditable="true"]`).click();
  await page.locator(CALLOUT_SELECTOR).hover();
  await page.getByTestId('settings-toggler').click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();

  const convertTo = page.locator(CONVERT_TO_OPTION);

  await expect(convertTo).toBeVisible();
  await convertTo.dispatchEvent('mouseover');
  await expect(page.locator(NESTED_POPOVER)).toBeVisible();
  await page.locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"]`).filter({ hasText: title }).first().click();
};

test.describe('callout: turn into', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page);
  });

  for (const caretIn of ['c1', 'c2']) {
    test(`turning a callout into text makes its first line the text, and undo brings it back (caret in ${caretIn})`, async ({ page }) => {
      const before = await savedBlocks(page);

      await turnCalloutInto(page, 'Text', caretIn);

      await expect.poll(() => savedBlocks(page)).toEqual([
        'before:paragraph:root:before',
        `C:paragraph:root:${FIRST}`,
        `c2:paragraph:root:${SECOND}`,
        'after:paragraph:root:after',
      ]);
      await expect(page.locator(CALLOUT_SELECTOR)).toHaveCount(0);

      await page.keyboard.press(`${MODIFIER_KEY}+z`);

      await expect.poll(() => savedBlocks(page)).toEqual(before);
      await expect(page.locator(CALLOUT_SELECTOR)).toHaveCount(1);
    });
  }

  test('turning a callout into a toggle makes its first line the title and keeps the rest inside', async ({ page }) => {
    await turnCalloutInto(page, 'Toggle list');

    await expect.poll(() => savedBlocks(page)).toEqual([
      'before:paragraph:root:before',
      `C:toggle:root:${FIRST}`,
      `c2:paragraph:C:${SECOND}`,
      'after:paragraph:root:after',
    ]);
  });
});
