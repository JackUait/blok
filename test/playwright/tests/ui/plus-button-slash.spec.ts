import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '../../../../types';
import type { OutputData } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

test.describe('plus button inserts slash paragraph', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('clicking plus button on block with content creates new paragraph with "/" below', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'Hello world' } },
    ]);

    // Locate the block by its content
    const firstBlock = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Hello world' });

    await firstBlock.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should have 2 blocks now
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);

    // Second block should be a paragraph with "/"
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR, { hasText: '/' });

    await expect(secondParagraph).toHaveText('/');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on empty paragraph reuses it and inserts "/"', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should still have 1 block (reused the empty paragraph)
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    // Block should now contain "/"
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('/');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on empty header creates new paragraph with "/" below', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'header', data: { text: '', level: 2 } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should have 2 blocks now (header + new paragraph)
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);

    // Second block should be a paragraph with "/"
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('/');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on paragraph with "/" does not add another "/"', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '/' } },
    ]);

    const block = page.locator(PARAGRAPH_SELECTOR, { hasText: '/' });

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should still have 1 block (reuses paragraph with "/")
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    // Block should still contain just "/" (not "//")
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('/');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on paragraph starting with "/" does not add another "/"', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '/head' } },
    ]);

    const block = page.locator(PARAGRAPH_SELECTOR, { hasText: '/head' });

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should still have 1 block (reuses paragraph with "/head")
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    // Block should still contain "/head" (not "//head")
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('/head');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('caret is positioned after "/" when paragraph already has one', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '/' } },
    ]);

    const block = page.locator(PARAGRAPH_SELECTOR, { hasText: '/' });

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Type something - it should appear after the "/"
    await page.keyboard.type('test');

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('/test');
  });

  test('alt+clicking plus button inserts paragraph with "/" above current block', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'First block' } },
      { type: 'paragraph', data: { text: 'Second block' } },
    ]);

    // Hover over the second block
    const secondBlock = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Second block' });

    await secondBlock.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();

    // Alt+click to insert above - dispatch events directly with altKey modifier
    await plusButton.dispatchEvent('mousedown', { bubbles: true, cancelable: true });
    await plusButton.dispatchEvent('mouseup', { bubbles: true, cancelable: true, altKey: true });

    // Should have 3 blocks now
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(3);

    // Verify the new paragraph with "/" was inserted between First and Second blocks
    // by checking the output data order
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTexts = outputData?.blocks.map((b: { data: { text: string } }) => b.data.text);

    expect(blockTexts).toStrictEqual(['First block', '/', 'Second block']);

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('alt+clicking plus button on first block inserts paragraph at the very top', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'Only block' } },
    ]);

    const block = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Only block' });

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();

    // Alt+click to insert above - dispatch events directly with altKey modifier
    await plusButton.dispatchEvent('mousedown', { bubbles: true, cancelable: true });
    await plusButton.dispatchEvent('mouseup', { bubbles: true, cancelable: true, altKey: true });

    // Should have 2 blocks now
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);

    // Verify the new paragraph with "/" was inserted at the top
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTexts = outputData?.blocks.map((b: { data: { text: string } }) => b.data.text);

    expect(blockTexts).toStrictEqual(['/', 'Only block']);

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('alt+clicking plus button on empty paragraph still reuses it', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'First block' } },
      { type: 'paragraph', data: { text: '' } },
    ]);

    // Hover over the empty second block (use filter to find the empty one)
    const emptyBlock = page.locator(BLOCK_SELECTOR).filter({ hasText: /^$/ });

    await emptyBlock.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();

    // Alt+click - dispatch events directly with altKey modifier
    await plusButton.dispatchEvent('mousedown', { bubbles: true, cancelable: true });
    await plusButton.dispatchEvent('mouseup', { bubbles: true, cancelable: true, altKey: true });

    // Should still have 2 blocks (empty paragraph was reused)
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);

    // Verify the second block now contains "/"
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTexts = outputData?.blocks.map((b: { data: { text: string } }) => b.data.text);

    expect(blockTexts).toStrictEqual(['First block', '/']);

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });
});
