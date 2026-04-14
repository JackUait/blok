import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const CALLOUT_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="callout"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

/**
 * Regression suite for the Enter-after-callout DOM/data desync.
 *
 * Bug: with a Callout block followed by a top-level paragraph, placing the caret
 * at offset 0 of the paragraph and pressing Enter would insert a new block whose
 * holder lands inside the Callout's nested-blocks container — even though the
 * new block's logical parentId is null. The flat-array predecessor (Callout's
 * auto-child) is DOM-nested, so insertAdjacentElement('afterend', predecessor)
 * dropped the new holder inside the wrong container.
 *
 * Fix: keyboardNavigation.createBlockOnEnter passes `forceTopLevel` to
 * insertDefaultBlockAtIndex when the current block is top-level, routing the
 * DOM anchor through Blocks.insertAtRootLevel.
 */
test.describe('Enter after callout regression', () => {
  test('caret at offset 0 of top-level paragraph after a callout: new block is top-level, not nested', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' } },
        { id: 'text-1', type: 'paragraph', data: { text: 'outside' } },
      ],
    });

    // Wait for callout's auto-created child paragraph to mount
    await expect(page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"]`)).toBeVisible();

    // Place caret at offset 0 of text-1
    await page.evaluate(() => {
      const editable = document.querySelector<HTMLElement>('[data-blok-id="text-1"] [contenteditable="true"]');

      if (editable === null) {
        throw new Error('text-1 editable not found');
      }
      editable.focus();
      const range = document.createRange();

      range.setStart(editable.firstChild ?? editable, 0);
      range.collapse(true);
      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
    });

    await page.keyboard.press('Enter');

    // Inspect DOM + data model
    const result = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (blok === undefined) {
        throw new Error('blok not ready');
      }
      const saved = await blok.save();
      const savedBlocks = saved.blocks.map((b) => ({
        id: b.id ?? '',
        parent: (b as { parent?: string }).parent,
      }));
      const domBlocks = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-id]')).map((el) => ({
        id: el.dataset.blokId ?? '',
        inNested: el.closest('[data-blok-nested-blocks]') !== null,
      }));

      return { savedBlocks, domBlocks };
    });

    // Data model: find the newly created block (top-level, not callout-1, not text-1)
    const newSaved = result.savedBlocks.find((b) =>
      b.id !== 'callout-1' && b.id !== 'text-1' && b.parent === undefined
    );

    expect(newSaved, 'new paragraph should exist at top level (parent undefined/null)').toBeDefined();

    // DOM model: the new block must NOT be inside any nested-blocks container
    const newBlockId = newSaved?.id ?? '';
    const newBlockDom = result.domBlocks.find((b) => b.id === newBlockId);

    expect(newBlockDom, 'new block must exist in DOM').toBeDefined();
    expect(newBlockDom?.inNested, 'new block must NOT be inside callout nested container').toBe(false);

    // Verify ordering: callout stays first, text-1 stays last, new block is somewhere between
    const savedIds = result.savedBlocks.map((b) => b.id);

    expect(savedIds[0]).toBe('callout-1');
    expect(savedIds[savedIds.length - 1]).toBe('text-1');
    expect(savedIds.indexOf(newBlockId)).toBeGreaterThan(0);
    expect(savedIds.indexOf(newBlockId)).toBeLessThan(savedIds.length - 1);
  });

  test('caret at offset 0 of top-level heading after a callout: new block is top-level', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' } },
        { id: 'h-1', type: 'header', data: { text: 'My heading', level: 2 } },
      ],
    });

    await expect(page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"]`)).toBeVisible();

    await page.evaluate(() => {
      const editable = document.querySelector<HTMLElement>('[data-blok-id="h-1"] [contenteditable="true"]');

      if (editable === null) {
        throw new Error('h-1 editable not found');
      }
      editable.focus();
      const range = document.createRange();

      range.setStart(editable.firstChild ?? editable, 0);
      range.collapse(true);
      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
    });

    await page.keyboard.press('Enter');

    // The heading h-1 must remain top-level (outside any nested container)
    await expect(page.locator('[data-blok-nested-blocks] [data-blok-id="h-1"]')).toHaveCount(0);

    // Only the callout's auto-child paragraph should be nested; no newly created block
    // should leak into the callout's nested container.
    await expect(page.locator('[data-blok-nested-blocks] [data-blok-id]')).toHaveCount(1);
  });

  test('caret at offset 0 of a nested child of a callout: new block stays inside the callout (regression guard)', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' } },
      ],
    });

    // Type something into the auto-child then move caret to start and press Enter
    const child = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"] [contenteditable]`);

    await child.click();
    await page.keyboard.type('callout body text');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');

    // Both child blocks must remain inside the callout's nested container
    await expect(
      page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"]`)
    ).toHaveCount(2);
  });
});
