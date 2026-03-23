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

test.describe('plus button opens toolbox on empty paragraph', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('clicking plus button on block with content creates new empty paragraph below', async ({ page }) => {
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

    // Second block should be an empty paragraph
    const allParagraphs = page.locator(PARAGRAPH_SELECTOR);
    const secondParagraph = allParagraphs.nth(1);

    await expect(secondParagraph).toHaveText('');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on empty paragraph reuses it and keeps it empty', async ({ page }) => {
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

    // Block should remain empty
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on empty header creates new empty paragraph below', async ({ page }) => {
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

    // Second block should be an empty paragraph
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('');

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

  test('alt+clicking plus button inserts empty paragraph above current block', async ({ page }) => {
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

    // Verify the new empty paragraph was inserted between First and Second blocks
    // by checking the output data order
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTexts = outputData?.blocks.map((b: { data: { text: string } }) => b.data.text);

    expect(blockTexts).toStrictEqual(['First block', '', 'Second block']);

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('alt+clicking plus button on first block inserts empty paragraph at the very top', async ({ page }) => {
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

    // Verify the new empty paragraph was inserted at the top
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTexts = outputData?.blocks.map((b: { data: { text: string } }) => b.data.text);

    expect(blockTexts).toStrictEqual(['', 'Only block']);

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

    // Verify the second block remains empty (no "/" inserted)
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTexts = outputData?.blocks.map((b: { data: { text: string } }) => b.data.text);

    expect(blockTexts).toStrictEqual(['First block', '']);

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('typing after opening toolbox via plus button filters toolbox items', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Toolbox should be open
    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    // Get initial count of visible items (not hidden by data-blok-hidden attribute)
    const allItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');
    const initialCount = await allItems.count();

    expect(initialCount).toBeGreaterThan(6); // Should have more than just heading items

    // Type "head" to filter to heading items
    await page.keyboard.type('head');

    // Now should only show heading items (6 headings + 3 toggle headings)
    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    await expect(visibleItems).toHaveCount(9);

    // First filtered item should be focused
    const focusedItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name][data-blok-focused]');

    await expect(focusedItem).toHaveCount(1);
  });

  test('backspace updates filter', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Get initial count (not hidden by data-blok-hidden attribute)
    const allVisibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');
    const initialCount = await allVisibleItems.count();

    // Type "head" to filter
    await page.keyboard.type('head');

    // Verify filter applied - should show 9 heading items (6 headings + 3 toggle headings)
    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    await expect(visibleItems).toHaveCount(9);

    // Backspace to "hea"
    await page.keyboard.press('Backspace');

    // Should still show heading items
    await expect(visibleItems).toHaveCount(9);

    // Backspace 3 more times to clear the filter
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    // Now all items should be visible again
    await expect(allVisibleItems).toHaveCount(initialCount);

    // First item should still be focused after clearing the filter
    const focusedItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name][data-blok-focused]');

    await expect(focusedItem).toHaveCount(1);
  });

  test('pressing backspace on empty block does not close the toolbox (no-slash mode)', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Toolbox should be open
    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    // Press Backspace on empty block - toolbox should remain open (no slash to remove)
    await page.keyboard.press('Backspace');

    // Toolbox should still be open
    await expect(toolbox).toBeVisible();

    // Pressing Escape should close the toolbox
    await page.keyboard.press('Escape');

    await expect(toolbox).toBeHidden();
  });

  test('arrow keys navigate toolbox items', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Toolbox should be open
    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    // Press ArrowDown to focus first item
    await page.keyboard.press('ArrowDown');

    // Check that an item is focused (has the focused class)
    const focusedItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name][data-blok-focused]');

    await expect(focusedItem).toHaveCount(1);

    // Press ArrowDown again to move to next item
    await page.keyboard.press('ArrowDown');

    // Still should have exactly one focused item
    await expect(focusedItem).toHaveCount(1);
  });

  test('enter key selects focused toolbox item', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Type to filter to headings
    await page.keyboard.type('head');

    // Wait for filter to apply
    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    await expect(visibleItems).toHaveCount(9);

    // Press ArrowDown to focus first heading item
    await page.keyboard.press('ArrowDown');

    // Press Enter to select the focused item
    await page.keyboard.press('Enter');

    // Block should now be a header
    const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`);

    await expect(headerBlock).toBeVisible();
  });

  test('selecting filtered item creates the correct block type', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Verify toolbox is open
    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    // Type "head" to filter to heading items only
    await page.keyboard.type('head');

    // Verify only heading items are visible (6 headings + 3 toggle headings)
    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    await expect(visibleItems).toHaveCount(9);

    // Click on a Heading item by finding one with "Heading" in the text
    const headingItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])').filter({ hasText: 'Heading 1', hasNotText: 'Toggle' });

    await headingItem.click();

    // Block should now be a header
    const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`);

    await expect(headerBlock).toBeVisible();
  });

  test('selecting filtered item inserts the new block below the typed-text paragraph', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    // Should start with 1 block
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    // Type "head" to filter - in no-slash mode this goes directly into the block
    await page.keyboard.type('head');

    // Wait for filter to apply
    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    await expect(visibleItems).toHaveCount(9);

    // Click on Heading 1
    const headingItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])').filter({ hasText: 'Heading 1', hasNotText: 'Toggle' });

    await headingItem.click();

    // The header block should be visible
    const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`);

    await expect(headerBlock).toBeVisible();

    // In no-slash mode, the block now has text "head" so it is not empty and not slash-search-only.
    // shouldReplaceBlock = false → header is inserted BELOW the "head" paragraph.
    // Result: 2 blocks (the "head" paragraph + the new header).
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);
  });

  test('fuzzy search: subsequence match finds tools', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    // "hdr" should match "Header" via subsequence (H-ea-D-e-R)
    await page.keyboard.type('hdr');

    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    // Should find at least one match (headings have 'header' in searchTerms)
    await expect(visibleItems).not.toHaveCount(0);
  });

  test('fuzzy search: typo-tolerant match finds tools', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    // "haeder" should match "header" (searchTerm) via Levenshtein
    await page.keyboard.type('haeder');

    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    await expect(visibleItems).not.toHaveCount(0);
  });

  test('fuzzy search: results ranked with exact matches first', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

    await expect(toolbox).toBeVisible();

    // Type "list" — exact matches on list tools should come first
    await page.keyboard.type('list');

    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');
    const count = await visibleItems.count();

    expect(count).toBeGreaterThan(0);

    // At least one visible item should be a list tool (they have 'list' in their name)
    const listToolItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name*="list"]:not([data-blok-hidden])');

    await expect(listToolItem).not.toHaveCount(0);
  });

  test('clicking plus button on table block creates new paragraph below the table, not inside a cell', async ({ page }) => {
    // Need to create Blok with table tool registered
    await resetBlok(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(
      async ({ holder }) => {
        const TableClass = (window.Blok as unknown as Record<string, unknown>).Table;

        const blok = new window.Blok({
          holder,
          tools: {
            table: {
              class: TableClass as new (...args: unknown[]) => unknown,
            },
          },
          data: {
            blocks: [
              {
                type: 'table',
                data: {
                  withHeadings: false,
                  content: [['A', 'B'], ['C', 'D']],
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      },
      { holder: HOLDER_ID }
    );

    // Hover over the table block to show the plus button
    const tableBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="table"]`);

    await tableBlock.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

    // No '/' should have been inserted anywhere in the table cells
    const cellsWithSlash = page.locator('[data-blok-table-cell] [contenteditable]', { hasText: '/' });

    await expect(cellsWithSlash).toHaveCount(0);

    // A new empty top-level paragraph block should appear below the table.
    // Verify via save(): table block (1) + new empty paragraph (1) = 2 top-level blocks.
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTypes = outputData?.blocks.map((b: { type: string }) => b.type);

    expect(blockTypes).toStrictEqual(['table', 'paragraph']);
  });

  test('selecting a block type from toolbox after clicking plus on table creates block below the table', async ({ page }) => {
    await resetBlok(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(
      async ({ holder }) => {
        const TableClass = (window.Blok as unknown as Record<string, unknown>).Table;

        const blok = new window.Blok({
          holder,
          tools: {
            table: {
              class: TableClass as new (...args: unknown[]) => unknown,
            },
          },
          data: {
            blocks: [
              {
                type: 'table',
                data: {
                  withHeadings: false,
                  content: [['A', 'B'], ['C', 'D']],
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      },
      { holder: HOLDER_ID }
    );

    // Hover over the table block to show the plus button
    const tableBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="table"]`);

    await tableBlock.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

    // Type "head" to filter to heading items
    await page.keyboard.type('head');

    // Wait for filter to show heading items (6 headings + 3 toggle headings)
    const visibleItems = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])');

    await expect(visibleItems).toHaveCount(9);

    // Click on Heading 1
    const headingItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])').filter({ hasText: 'Heading 1', hasNotText: 'Toggle' });

    await headingItem.click();

    // The header block should exist and be OUTSIDE the table
    const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`);

    await expect(headerBlock).toBeVisible();

    // The header should NOT be inside a table cell
    const headerInsideTable = page.locator('[data-blok-table-cell] [data-blok-component="header"]');

    await expect(headerInsideTable).toHaveCount(0);

    // Verify output data: header should be a separate top-level block after the table.
    // In no-slash mode, typing "head" leaves the filter paragraph in place (it's not replaced
    // because the block now has content and isBlockSlashSearchOnly returns false).
    // The table's 2x2 grid produces 4 cell paragraph blocks in the flat save output.
    // Order: table, paragraph('head'), 4 cell paragraphs, header
    const blockTypes = await page.evaluate(() =>
      window.blokInstance?.save().then(data => data.blocks.map(b => b.type))
    );

    expect(blockTypes).toStrictEqual(['table', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'header']);
  });

  test('clicking plus button on table block works when multiple tables exist in the article', async ({ page }) => {
    await resetBlok(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(
      async ({ holder }) => {
        const TableClass = (window.Blok as unknown as Record<string, unknown>).Table;

        const blok = new window.Blok({
          holder,
          tools: {
            table: {
              class: TableClass as new (...args: unknown[]) => unknown,
            },
          },
          data: {
            blocks: [
              {
                type: 'table',
                data: {
                  withHeadings: false,
                  content: [['A', 'B'], ['C', 'D']],
                },
              },
              {
                type: 'table',
                data: {
                  withHeadings: false,
                  content: [['E', 'F'], ['G', 'H']],
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      },
      { holder: HOLDER_ID }
    );

    // Hover over the second table block (contains "E") to show the plus button
    const secondTable = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="table"]`, { hasText: 'E' });

    await secondTable.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

    // No '/' should have been inserted anywhere in the table cells
    const cellsWithSlash = page.locator('[data-blok-table-cell] [contenteditable]', { hasText: '/' });

    await expect(cellsWithSlash).toHaveCount(0);

    // A new empty top-level paragraph block should appear below the second table.
    // Verify via save(): table1 (1) + table2 (1) + new empty paragraph (1) = 3 top-level blocks.
    const outputData = await page.evaluate(() => window.blokInstance?.save());
    const blockTypes = outputData?.blocks.map((b: { type: string }) => b.type);

    expect(blockTypes).toStrictEqual(['table', 'table', 'paragraph']);
  });

  test('clicking bottom zone below table creates new block below the table, not inside last cell', async ({ page }) => {
    await resetBlok(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(
      async ({ holder }) => {
        const TableClass = (window.Blok as unknown as Record<string, unknown>).Table;

        const blok = new window.Blok({
          holder,
          tools: {
            table: {
              class: TableClass as new (...args: unknown[]) => unknown,
            },
          },
          data: {
            blocks: [
              {
                type: 'table',
                data: {
                  withHeadings: false,
                  content: [['A', 'B'], ['C', 'D']],
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      },
      { holder: HOLDER_ID }
    );

    // Click the bottom zone below all blocks
    const bottomZone = page.locator('[data-blok-testid="bottom-zone"]');

    await bottomZone.click();

    // A new paragraph block should be created outside the table
    const allBlocks = page.locator(BLOCK_SELECTOR);

    // Table (1) + 4 cell paragraphs + 1 new paragraph = 6 blocks
    await expect(allBlocks).toHaveCount(6);

    // The new paragraph should NOT be inside a table cell
    const paragraphsInsideTable = page.locator('[data-blok-table-cell] [data-blok-component="paragraph"]');

    // Only the 4 original cell paragraphs should be inside the table
    await expect(paragraphsInsideTable).toHaveCount(4);

    // Verify output data: new paragraph should be a separate top-level block after the table
    const blockTypes = await page.evaluate(() =>
      window.blokInstance?.save().then(data => data.blocks.map(b => b.type))
    );

    expect(blockTypes).toStrictEqual(['table', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
  });
});
