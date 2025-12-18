import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../fixtures/test.html')
).href;
const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const CONTENTLESS_TOOL_SELECTOR = '[data-blok-testid-type="contentless-tool"]';
const LIST_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="list"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
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
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

const createParagraphBlok = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createBlokWithBlocks(page, blocks);
};

const createBlokWithContentlessBlock = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    /**
     * Mock contentless tool for testing
     */
    class ContentlessToolMock {
      /**
       * Mark as contentless
       */
      public static get contentless(): boolean {
        return true;
      }

      /**
       * Render the tool
       */
      public render(): HTMLElement {
        const wrapper = document.createElement('div');

        wrapper.setAttribute('data-blok-testid', 'contentless-tool');
        wrapper.setAttribute('data-blok-testid-type', 'contentless-tool');
        wrapper.textContent = '***';

        return wrapper;
      }

      /**
       * Save the tool data
       */
      public save(): Record<string, never> {
        return {};
      }
    }

    const blok = new window.Blok({
      holder: holder,
      tools: {
        delimiter: ContentlessToolMock,
      },
      data: {
        blocks: [
          {
            id: 'block1',
            type: 'paragraph',
            data: {
              text: 'First paragraph',
            },
          },
          {
            id: 'block2',
            type: 'delimiter',
            data: {},
          },
          {
            id: 'block3',
            type: 'paragraph',
            data: {
              text: 'Last paragraph',
            },
          },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
};

const getCaretInfo = (locator: Locator): Promise<{ inside: boolean; offset: number; textLength: number } | null> => {
  return locator.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);

    return {
      inside: element.contains(range.startContainer),
      offset: range.startOffset,
      textLength: element.textContent?.length ?? 0,
    };
  });
};

const getCaretInfoOrThrow = async (
  locator: Locator
): Promise<{ inside: boolean; offset: number; textLength: number }> => {
  const caretInfo = await getCaretInfo(locator);

  if (caretInfo === null) {
    throw new Error('Failed to retrieve caret information.');
  }

  return caretInfo;
};

const waitForCaretInBlock = async (page: Page, locator: Locator, expectedBlockIndex: number): Promise<void> => {
  await expect.poll(async () => {
    const caretInfo = await getCaretInfo(locator);

    if (!caretInfo || !caretInfo.inside) {
      return null;
    }

    const currentIndex = await page.evaluate(() => {
      return window.blokInstance?.blocks.getCurrentBlockIndex?.() ?? -1;
    });

    return currentIndex;
  }, {
    message: `Expected caret to land inside block with index ${expectedBlockIndex}`,
  }).toBe(expectedBlockIndex);
};

/**
 * Gets the X coordinate of the current caret position
 */
const getCaretXPosition = async (page: Page): Promise<number | null> => {
  return page.evaluate(() => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    return rect.left;
  });
};

/**
 * Sets the caret at a specific character offset within an element
 */
const setCaretAtOffset = async (locator: Locator, offset: number): Promise<void> => {
  await locator.evaluate((element, targetOffset) => {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let currentOffset = 0;
    let targetNode: Text | null = null;
    let nodeOffset = 0;

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const nodeLength = textNode.length;

      if (currentOffset + nodeLength >= targetOffset) {
        targetNode = textNode;
        nodeOffset = targetOffset - currentOffset;
        break;
      }

      currentOffset += nodeLength;
    }

    if (targetNode) {
      range.setStart(targetNode, nodeOffset);
      range.setEnd(targetNode, nodeOffset);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, offset);
};

/**
 * Creates a Blok editor with list tool enabled
 */
const createBlokWithListTool = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      tools: {
         
        list: (window as any).Blok.List,
      },
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

/**
 * Create list data with multiple items as separate blocks
 */
const createListItems = (
  items: Array<{ text: string; depth?: number }>,
  style: 'unordered' | 'ordered' | 'checklist' = 'ordered'
): OutputData['blocks'] => items.map((item, index) => ({
  id: `list-item-${index}`,
  type: 'list',
  data: {
    text: item.text,
    style,
    ...(item.depth !== undefined && item.depth > 0 ? { depth: item.depth } : {}),
  },
}));

/**
 * Checks if the caret is visible by verifying the selection range has non-zero dimensions
 * and is within the viewport
 */
const getCaretVisibility = async (page: Page): Promise<{
  isVisible: boolean;
  rect: { top: number; left: number; bottom: number; right: number; height: number; width: number } | null;
  inViewport: boolean;
}> => {
  return page.evaluate(() => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return { isVisible: false, rect: null, inViewport: false };
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // A zero-dimension rect means the caret is not properly rendered
    const hasValidDimensions = rect.height > 0 || (rect.width === 0 && rect.left !== 0);

    // Check if the rect is within the viewport
    const inViewport = rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;

    return {
      isVisible: hasValidDimensions,
      rect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        height: rect.height,
        width: rect.width,
      },
      inViewport,
    };
  });
};

test.describe('arrow up/down keydown - Notion-style vertical navigation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('basic vertical navigation between blocks', () => {
    test('should move caret to next block when pressing ArrowDown at last line', async ({ page }) => {
      await createParagraphBlok(page, ['First block', 'Second block']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowDown');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should move caret to previous block when pressing ArrowUp at first line', async ({ page }) => {
      await createParagraphBlok(page, ['First block', 'Second block']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowUp');

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await getCaretInfoOrThrow(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should not move to next block when not at last line of multi-line block', async ({ page }) => {
      // Create a block with multiple lines using <br>
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Line 1<br>Line 2<br>Line 3' } },
        { type: 'paragraph', data: { text: 'Next block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Home');

      // Press ArrowDown - should move within the block, not to next block
      await page.keyboard.press('ArrowDown');

      // Caret should still be in the first block
      const caretInfo = await getCaretInfoOrThrow(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });
  });

  test.describe('horizontal position preservation', () => {
    test('should preserve horizontal position when moving down between blocks', async ({ page }) => {
      // Create blocks with different lengths
      await createParagraphBlok(page, [
        'Short text here',
        'Another line of text',
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();

      // Position caret in the middle of the first block (offset 6 = "Short ")
      await setCaretAtOffset(firstParagraph, 6);

      // Get the X position before navigation
      const xBefore = await getCaretXPosition(page);

      // Navigate down
      await page.keyboard.press('ArrowDown');

      await waitForCaretInBlock(page, secondParagraph, 1);

      // Get the X position after navigation
      const xAfter = await getCaretXPosition(page);

      // The X positions should be approximately the same (within 50px tolerance)
      // This accounts for different character widths
      expect(xBefore).not.toBeNull();
      expect(xAfter).not.toBeNull();
      expect(Math.abs(xAfter! - xBefore!)).toBeLessThan(50);
    });

    test('should preserve horizontal position when moving up between blocks', async ({ page }) => {
      await createParagraphBlok(page, [
        'First line of text',
        'Second line here',
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.click();

      // Position caret in the middle of the second block
      await setCaretAtOffset(secondParagraph, 7);

      // Get the X position before navigation
      const xBefore = await getCaretXPosition(page);

      // Navigate up
      await page.keyboard.press('ArrowUp');

      await waitForCaretInBlock(page, firstParagraph, 0);

      // Get the X position after navigation
      const xAfter = await getCaretXPosition(page);

      // The X positions should be approximately the same
      expect(xBefore).not.toBeNull();
      expect(xAfter).not.toBeNull();
      expect(Math.abs(xAfter! - xBefore!)).toBeLessThan(50);
    });

    test('should clamp to end of shorter block when target X exceeds block length', async ({ page }) => {
      await createParagraphBlok(page, [
        'This is a very long line of text that extends far',
        'Short',
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await page.keyboard.press('End'); // Go to end of long line

      await page.keyboard.press('ArrowDown');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
      // Caret should be at or near the end of the shorter block
      expect(caretInfo.offset).toBeLessThanOrEqual(caretInfo.textLength);
    });
  });

  test.describe('empty block handling', () => {
    test('should immediately jump to next block from empty block on ArrowDown', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: '' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await page.keyboard.press('ArrowDown');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should immediately jump to previous block from empty block on ArrowUp', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: '' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.click();
      await page.keyboard.press('ArrowUp');

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await getCaretInfoOrThrow(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });
  });

  test.describe('contentless block handling', () => {
    test('should select contentless block when navigating down to it', async ({ page }) => {
      await createBlokWithContentlessBlock(page);

      const firstParagraph = getParagraphByIndex(page, 0);
      const contentlessBlock = page.locator(BLOCK_SELECTOR, {
        has: page.locator(CONTENTLESS_TOOL_SELECTOR),
      });

      await firstParagraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowDown');

      await expect(contentlessBlock).toHaveAttribute('data-blok-selected', 'true');
    });

    test('should select contentless block when navigating up to it', async ({ page }) => {
      await createBlokWithContentlessBlock(page);

      const lastParagraph = getParagraphByIndex(page, 1);
      const contentlessBlock = page.locator(BLOCK_SELECTOR, {
        has: page.locator(CONTENTLESS_TOOL_SELECTOR),
      });

      await lastParagraph.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowUp');

      await expect(contentlessBlock).toHaveAttribute('data-blok-selected', 'true');
    });

    test('should navigate past contentless block with ArrowDown', async ({ page }) => {
      await createBlokWithContentlessBlock(page);

      const firstParagraph = getParagraphByIndex(page, 0);
      const contentlessBlock = page.locator(BLOCK_SELECTOR, {
        has: page.locator(CONTENTLESS_TOOL_SELECTOR),
      });
      const lastParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowDown');

      await expect(contentlessBlock).toHaveAttribute('data-blok-selected', 'true');

      // Press ArrowDown again to move past the contentless block
      await page.keyboard.press('ArrowDown');

      // The contentless block should no longer be selected
      await expect(contentlessBlock).not.toHaveAttribute('data-blok-selected', 'true');

      // The caret should now be inside the last paragraph (block index 2)
      await waitForCaretInBlock(page, lastParagraph, 2);

      const caretInfo = await getCaretInfoOrThrow(lastParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should navigate past contentless block with ArrowUp', async ({ page }) => {
      await createBlokWithContentlessBlock(page);

      const firstParagraph = getParagraphByIndex(page, 0);
      const contentlessBlock = page.locator(BLOCK_SELECTOR, {
        has: page.locator(CONTENTLESS_TOOL_SELECTOR),
      });
      const lastParagraph = getParagraphByIndex(page, 1);

      await lastParagraph.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowUp');

      await expect(contentlessBlock).toHaveAttribute('data-blok-selected', 'true');

      // Press ArrowUp again to move past the contentless block
      await page.keyboard.press('ArrowUp');

      // The contentless block should no longer be selected
      await expect(contentlessBlock).not.toHaveAttribute('data-blok-selected', 'true');

      // The caret should now be inside the first paragraph (block index 0)
      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await getCaretInfoOrThrow(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });
  });

  test.describe('boundary conditions', () => {
    test('should not navigate past first block on ArrowUp', async ({ page }) => {
      await createParagraphBlok(page, ['Only block']);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowUp');

      const caretInfo = await getCaretInfoOrThrow(paragraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should not navigate past last block on ArrowDown', async ({ page }) => {
      await createParagraphBlok(page, ['Only block']);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowDown');

      const caretInfo = await getCaretInfoOrThrow(paragraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should navigate through multiple blocks sequentially with ArrowDown', async ({ page }) => {
      await createParagraphBlok(page, ['Block 1', 'Block 2', 'Block 3', 'Block 4']);

      const block1 = getParagraphByIndex(page, 0);
      const block2 = getParagraphByIndex(page, 1);
      const block3 = getParagraphByIndex(page, 2);
      const block4 = getParagraphByIndex(page, 3);

      await block1.click();
      await page.keyboard.press('End');

      await page.keyboard.press('ArrowDown');
      await waitForCaretInBlock(page, block2, 1);

      await page.keyboard.press('ArrowDown');
      await waitForCaretInBlock(page, block3, 2);

      await page.keyboard.press('ArrowDown');
      await waitForCaretInBlock(page, block4, 3);

      const caretInfo = await getCaretInfoOrThrow(block4);

      expect(caretInfo.inside).toBe(true);
    });

    test('should navigate through multiple blocks sequentially with ArrowUp', async ({ page }) => {
      await createParagraphBlok(page, ['Block 1', 'Block 2', 'Block 3', 'Block 4']);

      const block1 = getParagraphByIndex(page, 0);
      const block2 = getParagraphByIndex(page, 1);
      const block3 = getParagraphByIndex(page, 2);
      const block4 = getParagraphByIndex(page, 3);

      await block4.click();
      await page.keyboard.press('Home');

      await page.keyboard.press('ArrowUp');
      await waitForCaretInBlock(page, block3, 2);

      await page.keyboard.press('ArrowUp');
      await waitForCaretInBlock(page, block2, 1);

      await page.keyboard.press('ArrowUp');
      await waitForCaretInBlock(page, block1, 0);

      const caretInfo = await getCaretInfoOrThrow(block1);

      expect(caretInfo.inside).toBe(true);
    });
  });

  test.describe('list item navigation with caret visibility', () => {
    test('caret remains visible when navigating down through list items from start of first item', async ({ page }) => {
      await createBlokWithListTool(page, createListItems([
        { text: 'First' },
        { text: 'Second' },
        { text: 'Third' },
      ]));

      const firstItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 1) [contenteditable="true"]`);
      const secondItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 2) [contenteditable="true"]`);
      const thirdItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 3) [contenteditable="true"]`);

      // Click on the first list item and set caret at position 0 (before "F")
      await firstItem.click();
      await setCaretAtOffset(firstItem, 0);

      // Verify initial caret visibility
      const initialVisibility = await getCaretVisibility(page);

      expect(initialVisibility.isVisible).toBe(true);

      // Press ArrowDown to move to second item
      await page.keyboard.press('ArrowDown');
      await waitForCaretInBlock(page, secondItem, 1);

      // Verify caret is visible after first ArrowDown
      const afterFirstDown = await getCaretVisibility(page);

      expect(afterFirstDown.isVisible).toBe(true);
      expect(afterFirstDown.inViewport).toBe(true);

      // Press ArrowDown again to move to third item
      await page.keyboard.press('ArrowDown');
      await waitForCaretInBlock(page, thirdItem, 2);

      // Verify caret is still visible after second ArrowDown
      const afterSecondDown = await getCaretVisibility(page);

      expect(afterSecondDown.isVisible).toBe(true);
      expect(afterSecondDown.inViewport).toBe(true);

      // Verify caret is actually inside the third item
      const caretInfo = await getCaretInfo(thirdItem);

      expect(caretInfo?.inside).toBe(true);
    });

    test('caret remains visible when navigating up through list items', async ({ page }) => {
      await createBlokWithListTool(page, createListItems([
        { text: 'First' },
        { text: 'Second' },
        { text: 'Third' },
      ]));

      const firstItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 1) [contenteditable="true"]`);
      const secondItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 2) [contenteditable="true"]`);
      const thirdItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 3) [contenteditable="true"]`);

      // Click on the third list item and set caret at position 0
      await thirdItem.click();
      await setCaretAtOffset(thirdItem, 0);

      // Press ArrowUp to move to second item
      await page.keyboard.press('ArrowUp');
      await waitForCaretInBlock(page, secondItem, 1);

      // Verify caret is visible after first ArrowUp
      const afterFirstUp = await getCaretVisibility(page);

      expect(afterFirstUp.isVisible).toBe(true);
      expect(afterFirstUp.inViewport).toBe(true);

      // Press ArrowUp again to move to first item
      await page.keyboard.press('ArrowUp');
      await waitForCaretInBlock(page, firstItem, 0);

      // Verify caret is still visible after second ArrowUp
      const afterSecondUp = await getCaretVisibility(page);

      expect(afterSecondUp.isVisible).toBe(true);
      expect(afterSecondUp.inViewport).toBe(true);

      // Verify caret is actually inside the first item
      const caretInfo = await getCaretInfo(firstItem);

      expect(caretInfo?.inside).toBe(true);
    });

    test('caret preserves horizontal position when navigating through list items', async ({ page }) => {
      await createBlokWithListTool(page, createListItems([
        { text: 'First item here' },
        { text: 'Second item text' },
        { text: 'Third one' },
      ]));

      const firstItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 1) [contenteditable="true"]`);
      const secondItem = page.locator(`:nth-match(${LIST_BLOCK_SELECTOR}, 2) [contenteditable="true"]`);

      // Click on the first list item and set caret in the middle
      await firstItem.click();
      await setCaretAtOffset(firstItem, 6); // After "First "

      // Get initial X position
      const xBefore = await getCaretXPosition(page);

      // Navigate down
      await page.keyboard.press('ArrowDown');
      await waitForCaretInBlock(page, secondItem, 1);

      // Get X position after navigation
      const xAfter = await getCaretXPosition(page);

      // Positions should be approximately the same (within 50px tolerance)
      expect(xBefore).not.toBeNull();
      expect(xAfter).not.toBeNull();
      expect(Math.abs(xAfter! - xBefore!)).toBeLessThan(50);
    });
  });
});
