import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { OutputData } from '@/types';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const LIST_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const INLINE_TOOLBAR_SELECTOR = INLINE_TOOLBAR_INTERFACE_SELECTOR;
const CONVERT_TO_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="convert-to"]`;
const NESTED_POPOVER_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`;
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

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

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);

  await page.evaluate(
    async ({ holder, blokData }) => {

      const BlokClass = window.Blok as any;
      const blok = new BlokClass({
        holder: holder,
        data: blokData,
        tools: {
          list: {
            class: BlokClass.List,
            inlineToolbar: true,
          },
          paragraph: {
            class: BlokClass.Paragraph,
            inlineToolbar: true,
          },
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokData: data,
    }
  );
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return window.blokInstance.save();
  });
};

const setSelectionRange = async (locator: Locator, start: number, end: number): Promise<void> => {
  if (start < 0 || end < start) {
    throw new Error(`Invalid selection offsets: start (${start}) must be >= 0 and end (${end}) must be >= start.`);
  }

  await locator.scrollIntoViewIfNeeded();
  await locator.focus();

  await locator.evaluate(
    (element, { start: selectionStart, end: selectionEnd }) => {
      const ownerDocument = element.ownerDocument;

      if (!ownerDocument) {
        return;
      }

      const selection = ownerDocument.getSelection();

      if (!selection) {
        return;
      }

      const textNodes: Text[] = [];
      const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);

      let currentNode = walker.nextNode();

      while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = walker.nextNode();
      }

      if (textNodes.length === 0) {
        return;
      }

      const findPosition = (offset: number): { node: Text; nodeOffset: number } | null => {
        let accumulated = 0;

        for (const node of textNodes) {
          const length = node.textContent?.length ?? 0;
          const nodeStart = accumulated;
          const nodeEnd = accumulated + length;

          if (offset >= nodeStart && offset <= nodeEnd) {
            return {
              node,
              nodeOffset: Math.min(length, offset - nodeStart),
            };
          }

          accumulated = nodeEnd;
        }

        if (offset === 0) {
          const firstNode = textNodes[0];

          return {
            node: firstNode,
            nodeOffset: 0,
          };
        }

        return null;
      };

      const startPosition = findPosition(selectionStart);
      const endPosition = findPosition(selectionEnd);

      if (!startPosition || !endPosition) {
        return;
      }

      const range = ownerDocument.createRange();

      range.setStart(startPosition.node, startPosition.nodeOffset);
      range.setEnd(endPosition.node, endPosition.nodeOffset);

      selection.removeAllRanges();
      selection.addRange(range);
      ownerDocument.dispatchEvent(new Event('selectionchange'));
    },
    { start,
      end }
  );
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  const fullText = await locator.textContent();

  if (!fullText || !fullText.includes(text)) {
    throw new Error(`Text "${text}" was not found in element`);
  }

  const startIndex = fullText.indexOf(text);
  const endIndex = startIndex + text.length;

  await setSelectionRange(locator, startIndex, endIndex);
};

const openInlineToolbar = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    window.blokInstance.inlineToolbar.open();
  });

  await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-testid="popover-container"]`)).toBeVisible();
};

test.describe('list item conversion via inline toolbar - merge with previous', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('converts middle item to separate paragraph block between list parts', async ({ page }) => {
    // List: Item A, Item B, Item C
    // Converting Item B should split the list: [Item A] + [paragraph: Item B] + [Item C]
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Item A', checked: false },
              { content: 'Item B', checked: false },
              { content: 'Item C', checked: false },
            ],
          },
        },
      ],
    });

    const listBlock = page.locator(LIST_BLOCK_SELECTOR);

    await expect(listBlock).toBeVisible();

    // Find the second item's content element
    const secondItemContent = listBlock.locator('[data-item-path="[1]"] [contenteditable="true"]');

    await expect(secondItemContent).toBeVisible();

    // Select text in the second item
    await selectText(secondItemContent, 'Item B');

    // Open inline toolbar
    await openInlineToolbar(page);

    // Click on "Convert to" button
    const convertToButton = page.locator(CONVERT_TO_BUTTON_SELECTOR);

    await expect(convertToButton).toBeVisible();
    await convertToButton.click();

    // Wait for nested popover and click on paragraph option
    const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

    await expect(nestedPopover).toBeVisible();

    const paragraphOption = nestedPopover.locator('[data-blok-item-name="paragraph"]');

    await expect(paragraphOption).toBeVisible();
    await paragraphOption.click();

    // Verify the result: Item B should become a separate paragraph block between list parts
    const savedData = await saveBlok(page);

    // Should have 3 blocks: list (Item A), paragraph (Item B), list (Item C)
    expect(savedData.blocks).toHaveLength(3);

    // First block: list with Item A
    expect(savedData.blocks[0].type).toBe('list');
    expect(savedData.blocks[0].data.items).toHaveLength(1);
    expect(savedData.blocks[0].data.items[0].content).toBe('Item A');

    // Second block: paragraph with Item B
    expect(savedData.blocks[1].type).toBe('paragraph');
    expect(savedData.blocks[1].data.text).toBe('Item B');

    // Third block: list with Item C
    expect(savedData.blocks[2].type).toBe('list');
    expect(savedData.blocks[2].data.items).toHaveLength(1);
    expect(savedData.blocks[2].data.items[0].content).toBe('Item C');

    // Should have created a separate paragraph block
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
  });

  test('converts first item to separate block when no previous item', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'First item', checked: false },
              { content: 'Second item', checked: false },
            ],
          },
        },
      ],
    });

    const listBlock = page.locator(LIST_BLOCK_SELECTOR);

    await expect(listBlock).toBeVisible();

    // Find the first item's content element
    const firstItemContent = listBlock.locator('[data-item-path="[0]"] [contenteditable="true"]');

    await expect(firstItemContent).toBeVisible();

    // Select text in the first item
    await selectText(firstItemContent, 'First item');

    // Open inline toolbar
    await openInlineToolbar(page);

    // Click on "Convert to" button
    const convertToButton = page.locator(CONVERT_TO_BUTTON_SELECTOR);

    await expect(convertToButton).toBeVisible();
    await convertToButton.click();

    // Wait for nested popover and click on paragraph option
    const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

    await expect(nestedPopover).toBeVisible();

    const paragraphOption = nestedPopover.locator('[data-blok-item-name="paragraph"]');

    await expect(paragraphOption).toBeVisible();
    await paragraphOption.click();

    // Verify the result: paragraph should be first, then list
    const savedData = await saveBlok(page);

    expect(savedData.blocks).toHaveLength(2);

    // First block should be the converted paragraph
    expect(savedData.blocks[0].type).toBe('paragraph');
    expect(savedData.blocks[0].data.text).toBe('First item');

    // Second block should be the list with remaining item
    expect(savedData.blocks[1].type).toBe('list');
    expect(savedData.blocks[1].data.items).toHaveLength(1);
    expect(savedData.blocks[1].data.items[0].content).toBe('Second item');
  });

  test('deletes list when converting the only item', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Only item', checked: false },
            ],
          },
        },
      ],
    });

    const listBlock = page.locator(LIST_BLOCK_SELECTOR);

    await expect(listBlock).toBeVisible();

    // Find the only item's content element
    const itemContent = listBlock.locator('[data-item-path="[0]"] [contenteditable="true"]');

    await expect(itemContent).toBeVisible();

    // Select text in the item
    await selectText(itemContent, 'Only item');

    // Open inline toolbar
    await openInlineToolbar(page);

    // Click on "Convert to" button
    const convertToButton = page.locator(CONVERT_TO_BUTTON_SELECTOR);

    await expect(convertToButton).toBeVisible();
    await convertToButton.click();

    // Wait for nested popover and click on paragraph option
    const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

    await expect(nestedPopover).toBeVisible();

    const paragraphOption = nestedPopover.locator('[data-blok-item-name="paragraph"]');

    await expect(paragraphOption).toBeVisible();
    await paragraphOption.click();

    // Verify the result: should have the converted paragraph (editor may add a default empty block)
    const savedData = await saveBlok(page);

    // First block should be the converted paragraph with content
    expect(savedData.blocks[0].type).toBe('paragraph');
    expect(savedData.blocks[0].data.text).toBe('Only item');

    // List should be gone
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(0);

    // Should have at least one paragraph (the converted one)
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(savedData.blocks.length);
  });

  test('converts nested item to separate paragraph block', async ({ page }) => {
    // List structure:
    // - Item A
    //   - Item B (converting this)
    // - Item C
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Item A',
                checked: false,
                items: [
                  { content: 'Item B', checked: false },
                ],
              },
              { content: 'Item C', checked: false },
            ],
          },
        },
      ],
    });

    const listBlock = page.locator(LIST_BLOCK_SELECTOR);

    await expect(listBlock).toBeVisible();

    // Find the nested item's content element (path [0, 0])
    const nestedItemContent = listBlock.locator('[data-item-path="[0,0]"] [contenteditable="true"]');

    await expect(nestedItemContent).toBeVisible();

    // Select text in the nested item
    await selectText(nestedItemContent, 'Item B');

    // Open inline toolbar
    await openInlineToolbar(page);

    // Click on "Convert to" button
    const convertToButton = page.locator(CONVERT_TO_BUTTON_SELECTOR);

    await expect(convertToButton).toBeVisible();
    await convertToButton.click();

    // Wait for nested popover and click on paragraph option
    const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

    await expect(nestedPopover).toBeVisible();

    const paragraphOption = nestedPopover.locator('[data-blok-item-name="paragraph"]');

    await expect(paragraphOption).toBeVisible();
    await paragraphOption.click();

    // Verify the result: Item B should become a separate paragraph block
    const savedData = await saveBlok(page);

    // Should have 3 blocks: list (Item A), paragraph (Item B), list (Item C)
    expect(savedData.blocks).toHaveLength(3);

    // First block: list with Item A (no nested items)
    expect(savedData.blocks[0].type).toBe('list');
    expect(savedData.blocks[0].data.items).toHaveLength(1);
    expect(savedData.blocks[0].data.items[0].content).toBe('Item A');
    expect(savedData.blocks[0].data.items[0].items).toBeUndefined();

    // Second block: paragraph with Item B
    expect(savedData.blocks[1].type).toBe('paragraph');
    expect(savedData.blocks[1].data.text).toBe('Item B');

    // Third block: list with Item C
    expect(savedData.blocks[2].type).toBe('list');
    expect(savedData.blocks[2].data.items).toHaveLength(1);
    expect(savedData.blocks[2].data.items[0].content).toBe('Item C');

    // Should have created a separate paragraph block
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
  });
});

test.describe('list item conversion - undo behavior', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('undo after converting list item should not leave fake background elements', async ({ page }) => {
    const FAKE_BACKGROUND_SELECTOR = '[data-blok-fake-background="true"]';

    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Item A', checked: false },
              { content: 'Item B', checked: false },
            ],
          },
        },
      ],
    });

    const listBlock = page.locator(LIST_BLOCK_SELECTOR);

    await expect(listBlock).toBeVisible();

    // Find the first item's content element
    const firstItemContent = listBlock.locator('[data-item-path="[0]"] [contenteditable="true"]');

    await expect(firstItemContent).toBeVisible();

    // Select text in the first item
    await selectText(firstItemContent, 'Item A');

    // Open inline toolbar
    await openInlineToolbar(page);

    // Click on "Convert to" button
    const convertToButton = page.locator(CONVERT_TO_BUTTON_SELECTOR);

    await expect(convertToButton).toBeVisible();
    await convertToButton.click();

    // Wait for nested popover and click on paragraph option
    const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

    await expect(nestedPopover).toBeVisible();

    const paragraphOption = nestedPopover.locator('[data-blok-item-name="paragraph"]');

    await expect(paragraphOption).toBeVisible();
    await paragraphOption.click();

    // Wait for conversion to complete
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

    // Perform undo
    await page.keyboard.press(UNDO_SHORTCUT);

    // Wait for undo to complete - list should be restored
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toBeVisible();

    // Verify no fake background elements remain in the DOM
    const fakeBackgroundCount = page.locator(FAKE_BACKGROUND_SELECTOR);

    await expect(fakeBackgroundCount).toHaveCount(0);
  });

  test('caret position is preserved after undoing list item to paragraph conversion', async ({ page }) => {
    const HISTORY_DEBOUNCE_WAIT = 500;
    const STATE_CHANGE_WAIT = 200;

    // Use a list with multiple items to avoid the "only item" case which deletes the list
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Hello World', checked: false },
              { content: 'Second item', checked: false },
            ],
          },
        },
      ],
    });

    const listBlock = page.locator(LIST_BLOCK_SELECTOR);

    await expect(listBlock).toBeVisible();

    // Find the first list item's content element
    const itemContent = listBlock.locator('[data-item-path="[0]"] [contenteditable="true"]');

    await expect(itemContent).toBeVisible();

    // Click to focus and place caret at a specific position (after "Hello")
    await itemContent.click();

    // Set caret position to offset 5 (after "Hello")
    await setSelectionRange(itemContent, 5, 5);

    // Wait for history to capture the initial state with caret position
    await page.evaluate(
      async (timeout) => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, timeout);
        });
      },
      HISTORY_DEBOUNCE_WAIT
    );

    // Select text to trigger inline toolbar
    await selectText(itemContent, 'Hello World');

    // Open inline toolbar
    await openInlineToolbar(page);

    // Click on "Convert to" button
    const convertToButton = page.locator(CONVERT_TO_BUTTON_SELECTOR);

    await expect(convertToButton).toBeVisible();
    await convertToButton.click();

    // Wait for nested popover and click on paragraph option
    const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

    await expect(nestedPopover).toBeVisible();

    const paragraphOption = nestedPopover.locator('[data-blok-item-name="paragraph"]');

    await expect(paragraphOption).toBeVisible();
    await paragraphOption.click();

    // Wait for conversion to complete - should have 1 paragraph and 1 list (with remaining item)
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(1);

    // Wait for history to record the conversion
    await page.evaluate(
      async (timeout) => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, timeout);
        });
      },
      HISTORY_DEBOUNCE_WAIT
    );

    // Perform undo
    await page.keyboard.press(UNDO_SHORTCUT);

    // Wait for undo to complete
    await page.evaluate(
      async (timeout) => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, timeout);
        });
      },
      STATE_CHANGE_WAIT
    );

    // Wait for list to be restored (should have 1 list with 2 items, no paragraph)
    await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(1);
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(0);

    // Verify focus is in the editor
    const isFocused = await page.evaluate(() => {
      const activeElement = document.activeElement;

      if (!activeElement) {
        return false;
      }

      const editorWrapper = document.querySelector('[data-blok-testid="blok"]');

      return editorWrapper?.contains(activeElement) ?? false;
    });

    expect(isFocused).toBe(true);

    // Wait a bit more for caret to be positioned
    await page.evaluate(
      async (timeout) => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, timeout);
        });
      },
      STATE_CHANGE_WAIT
    );

    // Verify we can continue typing immediately (caret is positioned correctly)
    await page.keyboard.type('!');

    // Wait for DOM to update
    await page.evaluate(
      async (timeout) => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, timeout);
        });
      },
      STATE_CHANGE_WAIT
    );

    // The restored list item should contain the typed character
    const restoredListBlock = page.locator(LIST_BLOCK_SELECTOR);
    const restoredItemContent = restoredListBlock.locator('[data-item-path="[0]"] [contenteditable="true"]');

    await expect(restoredItemContent).toContainText('!');
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
