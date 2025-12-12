/* eslint-disable playwright/no-nth-methods */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const LIST_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="list"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`;

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
  inlineToolbar?: boolean | string[];
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
  inlineToolbar?: boolean;
};

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

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data = null, tools = {}, inlineToolbar } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
    inlineToolbar: tool.inlineToolbar,
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig, inlineToolbar: enableInlineToolbar }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (enableInlineToolbar !== undefined) {
        blokConfig.inlineToolbar = enableInlineToolbar;
      }

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<
          Record<string, { class: unknown; inlineToolbar?: boolean | string[] } & Record<string, unknown>>
        >((accumulator, { name, className, config, inlineToolbar: toolInlineToolbar }) => {
          let toolClass: unknown = null;

          if (className) {
            toolClass = className.split('.').reduce(
              (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
              window
            ) ?? null;
          }

          if (!toolClass) {
            throw new Error(`Tool "${name}" is not available globally`);
          }

          const toolConfig: { class: unknown; inlineToolbar?: boolean | string[] } & Record<string, unknown> = {
            class: toolClass,
            ...config,
          };

          if (toolInlineToolbar !== undefined) {
            toolConfig.inlineToolbar = toolInlineToolbar;
          }

          return {
            ...accumulator,
            [name]: toolConfig,
          };
        }, {});

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
      inlineToolbar,
    }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  list: {
    className: 'Blok.List',
    inlineToolbar: true,
  },
};

/**
 * Create list data with multiple items as separate blocks (new hierarchical format).
 * Each item is a separate block with text, style, and optional depth for nesting.
 */
const createListItems = (
  items: Array<{ text: string; depth?: number; checked?: boolean }>,
  style: 'unordered' | 'ordered' | 'checklist' = 'unordered'
): OutputData => ({
  blocks: items.map((item, index) => ({
    id: `list-item-${index}`,
    type: 'list',
    data: {
      text: item.text,
      style,
      checked: item.checked ?? false,
      ...(item.depth !== undefined && item.depth > 0 ? { depth: item.depth } : {}),
    },
  })),
});

test.describe('list tool (ListItem)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders unordered list items', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ]),
      });

      const listItems = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listItems).toHaveCount(3);
      await expect(page.getByText('First item')).toBeVisible();
      await expect(page.getByText('Second item')).toBeVisible();
      await expect(page.getByText('Third item')).toBeVisible();
    });

    test('renders ordered list items', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
        ], 'ordered'),
      });

      const listItems = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listItems).toHaveCount(2);
      await expect(listItems.first()).toHaveAttribute('data-list-style', 'ordered');
    });

    test('renders checklist items', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'Task one', checked: false },
          { text: 'Task two', checked: true },
        ], 'checklist'),
      });

      const listItems = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listItems).toHaveCount(2);
      await expect(listItems.first()).toHaveAttribute('data-list-style', 'checklist');
    });

    test('renders ordered list items with custom start number', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'First', style: 'ordered', start: 800 } },
            { id: 'list-2', type: 'list', data: { text: 'Second', style: 'ordered' } },
            { id: 'list-3', type: 'list', data: { text: 'Third', style: 'ordered' } },
          ],
        },
      });

      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);

      await expect(markers).toHaveCount(3);
      await expect(markers.nth(0)).toHaveText('800.');
      await expect(markers.nth(1)).toHaveText('801.');
      await expect(markers.nth(2)).toHaveText('802.');
    });
  });

  test.describe('editing', () => {
    test('allows editing list item text', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([{ text: 'Original text' }]),
      });

      const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

      await listItem.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' - Updated');

      await expect(listItem).toHaveText('Original text - Updated');
    });

    test('creates new item on Enter in non-empty item', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([{ text: 'First item' }]),
      });

      const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

      await listItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Should have two list blocks now
      const items = page.locator(LIST_BLOCK_SELECTOR);

      await expect(items).toHaveCount(2);
    });
  });

  test.describe('enter on empty item exits list', () => {
    test('enter on empty item creates paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([{ text: 'First item' }]),
      });

      const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

      await listItem.click();
      await page.keyboard.press('End');

      // First Enter - creates a new empty item
      await page.keyboard.press('Enter');

      const items = page.locator(LIST_BLOCK_SELECTOR);

      await expect(items).toHaveCount(2);

      // Second Enter on empty item - should exit list and create paragraph
      await page.keyboard.press('Enter');

      // Should still have the list with one item
      await expect(items).toHaveCount(1);

      // Should have a new paragraph block after the list
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
    });

    test('enter on single empty item replaces list with paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([{ text: '' }]),
      });

      const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);

      await listItem.click();

      // Enter on empty item should exit list
      await page.keyboard.press('Enter');

      // List should be gone, replaced by paragraph
      const list = page.locator(LIST_BLOCK_SELECTOR);

      await expect(list).toHaveCount(0);

      // At least one paragraph should exist
      const paragraphCount = await page.locator(PARAGRAPH_BLOCK_SELECTOR).count();

      expect(paragraphCount).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('indentation with Tab/Shift+Tab', () => {
    test('tab increases depth on second item', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
        ]),
      });

      // Click on second item
      const secondItem = page.locator(LIST_BLOCK_SELECTOR).nth(1).locator('[contenteditable="true"]');

      await secondItem.click();

      // Press Tab to indent
      await page.keyboard.press('Tab');

      // Save and verify depth increased
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(2);
      expect(savedData?.blocks[1].data.depth).toBe(1);
    });

    test('tab does not indent first item', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
        ]),
      });

      // Click on first item
      const firstItem = page.locator(LIST_BLOCK_SELECTOR).first().locator('[contenteditable="true"]');

      await firstItem.click();

      // Press Tab - should not indent
      await page.keyboard.press('Tab');

      // Save and verify depth is still 0
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
    });

    test('shift+tab decreases depth', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Nested item', depth: 1 },
        ]),
      });

      // Click on second (nested) item
      const nestedItem = page.locator(LIST_BLOCK_SELECTOR).nth(1).locator('[contenteditable="true"]');

      await nestedItem.click();

      // Press Shift+Tab to outdent
      await page.keyboard.press('Shift+Tab');

      // Save and verify depth decreased
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth ?? 0).toBe(0);
    });

    test('shift+tab on root item does nothing', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
        ]),
      });

      // Click on first item (root level)
      const firstItem = page.locator(LIST_BLOCK_SELECTOR).first().locator('[contenteditable="true"]');

      await firstItem.click();

      // Press Shift+Tab - should not change anything
      await page.keyboard.press('Shift+Tab');

      // Save and verify still 2 items at root level
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(2);
      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
    });
  });

  test.describe('data saving', () => {
    test('saves list data correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
        ]),
      });

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(2);
      expect(savedData?.blocks[0].type).toBe('list');
      expect(savedData?.blocks[0].data.text).toBe('First');
      expect(savedData?.blocks[1].data.text).toBe('Second');
    });

    test('saves nested items with depth', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'Parent' },
          { text: 'Child', depth: 1 },
        ]),
      });

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(2);
      expect(savedData?.blocks[0].data.text).toBe('Parent');
      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
      expect(savedData?.blocks[1].data.text).toBe('Child');
      expect(savedData?.blocks[1].data.depth).toBe(1);
    });
  });

  test.describe('focus management', () => {
    test('focus remains on content element after indent', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
        ]),
      });

      // Click on second item
      const secondItem = page.locator(LIST_BLOCK_SELECTOR).nth(1).locator('[contenteditable="true"]');
      await secondItem.click();

      // Press Tab to indent
      await page.keyboard.press('Tab');

      // Wait for the second item to be indented (depth attribute changes)
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(1)).toHaveAttribute('data-list-depth', '1');

      // Wait for focus to be restored after requestAnimationFrame in setCaretToBlockContent
      await page.waitForFunction(() => {
        const active = document.activeElement;
        return active?.getAttribute('contenteditable') === 'true';
      }, { timeout: 2000 });

      // Verify focus is on a contenteditable element
      const activeElement = await page.evaluate(() => {
        const active = document.activeElement;
        return {
          isContentEditable: active?.getAttribute('contenteditable') === 'true',
          tagName: active?.tagName,
        };
      });

      expect(activeElement.isContentEditable).toBe(true);
    });

    test('focus remains on content element after outdent', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Nested item', depth: 1 },
        ]),
      });

      // Click on nested item
      const nestedItem = page.locator(LIST_BLOCK_SELECTOR).nth(1).locator('[contenteditable="true"]');
      await nestedItem.click();

      // Press Shift+Tab to outdent
      await page.keyboard.press('Shift+Tab');

      // Wait for the nested item to be outdented (depth attribute changes to 0)
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(1)).toHaveAttribute('data-list-depth', '0');

      // Verify focus is on a contenteditable element
      const activeElement = await page.evaluate(() => {
        const active = document.activeElement;
        return {
          isContentEditable: active?.getAttribute('contenteditable') === 'true',
          tagName: active?.tagName,
        };
      });

      expect(activeElement.isContentEditable).toBe(true);
    });

    test('focus moves to new item after enter', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([{ text: 'First item' }]),
      });

      const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
      await listItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Wait for the second list block to appear
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      // Verify focus is on a contenteditable element in the second list block
      const activeElement = await page.evaluate(() => {
        const active = document.activeElement;
        const listBlocks = document.querySelectorAll('[data-blok-tool="list"]');
        const secondBlock = listBlocks[1];
        const isInSecondBlock = secondBlock?.contains(active);
        return {
          isContentEditable: active?.getAttribute('contenteditable') === 'true',
          isInSecondBlock,
        };
      });

      expect(activeElement.isContentEditable).toBe(true);
      expect(activeElement.isInSecondBlock).toBe(true);
    });

    test('backspace at start converts list item to paragraph (Notion behavior)', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
        ]),
      });

      // Click on second item and set cursor to the start using JavaScript
      // (Home key behavior varies across browsers)
      const secondItem = page.locator(LIST_BLOCK_SELECTOR).nth(1).locator('[contenteditable="true"]');
      await secondItem.click();
      await page.evaluate(() => {
        const selection = window.getSelection();
        const listBlocks = document.querySelectorAll('[data-blok-tool="list"]');
        const secondBlock = listBlocks[1];
        const contentEl = secondBlock?.querySelector('[contenteditable="true"]');
        if (contentEl && selection) {
          const range = document.createRange();
          range.setStart(contentEl, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });

      // Press Backspace - should convert to paragraph, not merge
      await page.keyboard.press('Backspace');

      // Should still have one list block (first item) and a new paragraph
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toBeVisible();

      // Verify the paragraph contains the second item's text
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toContainText('Second item');

      // Verify focus is on a contenteditable element in the paragraph
      const activeElement = await page.evaluate(() => {
        const active = document.activeElement;
        const paragraph = document.querySelector('[data-blok-tool="paragraph"]');
        const isInParagraph = paragraph?.contains(active);
        return {
          isContentEditable: active?.getAttribute('contenteditable') === 'true',
          isInParagraph,
        };
      });

      expect(activeElement.isContentEditable).toBe(true);
      expect(activeElement.isInParagraph).toBe(true);
    });

    test('focus moves to paragraph after exiting list', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([{ text: '' }]),
      });

      const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
      await listItem.click();

      // Enter on empty item should exit list
      await page.keyboard.press('Enter');

      // Wait for paragraph to appear (list should be converted)
      // Use .first() since there may be multiple paragraphs (e.g., a default empty one)
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR).first()).toBeVisible();

      // Verify focus is on a contenteditable element (should be paragraph)
      const activeElement = await page.evaluate(() => {
        const active = document.activeElement;
        const paragraph = document.querySelector('[data-blok-tool="paragraph"]');
        const isInParagraph = paragraph?.contains(active);
        return {
          isContentEditable: active?.getAttribute('contenteditable') === 'true',
          isInParagraph,
        };
      });

      expect(activeElement.isContentEditable).toBe(true);
      expect(activeElement.isInParagraph).toBe(true);
    });
  });

  test.describe('style boundaries - list numbering resets on style change', () => {
    test('ordered list restarts numbering after unordered item at same depth', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'Ordered 1', style: 'ordered' } },
            { id: 'list-2', type: 'list', data: { text: 'Ordered 2', style: 'ordered' } },
            { id: 'list-3', type: 'list', data: { text: 'Unordered', style: 'unordered' } },
            { id: 'list-4', type: 'list', data: { text: 'Ordered 3', style: 'ordered' } },
            { id: 'list-5', type: 'list', data: { text: 'Ordered 4', style: 'ordered' } },
          ],
        },
      });

      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);

      // First two ordered items: 1. 2.
      await expect(markers.nth(0)).toHaveText('1.');
      await expect(markers.nth(1)).toHaveText('2.');
      // Third is unordered bullet
      await expect(markers.nth(2)).toHaveText('•');
      // Fourth and fifth should restart: 1. 2. (not 3. 4.)
      await expect(markers.nth(3)).toHaveText('1.');
      await expect(markers.nth(4)).toHaveText('2.');
    });

    test('ordered list restarts numbering after checklist item at same depth', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'Ordered 1', style: 'ordered' } },
            { id: 'list-2', type: 'list', data: { text: 'Task', style: 'checklist', checked: false } },
            { id: 'list-3', type: 'list', data: { text: 'Ordered 2', style: 'ordered' } },
          ],
        },
      });

      const orderedMarkers = page.locator(`${LIST_BLOCK_SELECTOR}[data-list-style="ordered"] [data-list-marker]`);

      // Both ordered items should be numbered 1. (not 1. and 2.)
      await expect(orderedMarkers.nth(0)).toHaveText('1.');
      await expect(orderedMarkers.nth(1)).toHaveText('1.');
    });

    test('nested ordered lists restart numbering after different style at same depth', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'Parent 1', style: 'ordered' } },
            { id: 'list-2', type: 'list', data: { text: 'Nested ordered 1', style: 'ordered', depth: 1 } },
            { id: 'list-3', type: 'list', data: { text: 'Nested ordered 2', style: 'ordered', depth: 1 } },
            { id: 'list-4', type: 'list', data: { text: 'Nested unordered', style: 'unordered', depth: 1 } },
            { id: 'list-5', type: 'list', data: { text: 'Nested ordered 3', style: 'ordered', depth: 1 } },
            { id: 'list-6', type: 'list', data: { text: 'Parent 2', style: 'ordered' } },
          ],
        },
      });

      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);

      // Parent 1: 1.
      await expect(markers.nth(0)).toHaveText('1.');
      // Nested ordered 1, 2: a. b. (depth 1 uses lowercase letters)
      await expect(markers.nth(1)).toHaveText('a.');
      await expect(markers.nth(2)).toHaveText('b.');
      // Nested unordered: hollow circle (depth 1 bullet)
      await expect(markers.nth(3)).toHaveText('◦');
      // Nested ordered 3 should restart: a. (not c.)
      await expect(markers.nth(4)).toHaveText('a.');
      // Parent 2: 2.
      await expect(markers.nth(5)).toHaveText('2.');
    });

    test('multiple style changes create independent list groups', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'Ordered A', style: 'ordered' } },
            { id: 'list-2', type: 'list', data: { text: 'Unordered 1', style: 'unordered' } },
            { id: 'list-3', type: 'list', data: { text: 'Ordered B', style: 'ordered' } },
            { id: 'list-4', type: 'list', data: { text: 'Unordered 2', style: 'unordered' } },
            { id: 'list-5', type: 'list', data: { text: 'Ordered C', style: 'ordered' } },
          ],
        },
      });

      const orderedMarkers = page.locator(`${LIST_BLOCK_SELECTOR}[data-list-style="ordered"] [data-list-marker]`);

      // All three ordered items should each be 1. (each is its own group)
      await expect(orderedMarkers.nth(0)).toHaveText('1.');
      await expect(orderedMarkers.nth(1)).toHaveText('1.');
      await expect(orderedMarkers.nth(2)).toHaveText('1.');
    });

    test('custom start value works correctly after style boundary', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'Ordered 1', style: 'ordered' } },
            { id: 'list-2', type: 'list', data: { text: 'Unordered', style: 'unordered' } },
            { id: 'list-3', type: 'list', data: { text: 'Ordered starting at 5', style: 'ordered', start: 5 } },
            { id: 'list-4', type: 'list', data: { text: 'Ordered 2', style: 'ordered' } },
          ],
        },
      });

      const orderedMarkers = page.locator(`${LIST_BLOCK_SELECTOR}[data-list-style="ordered"] [data-list-marker]`);

      await expect(orderedMarkers.nth(0)).toHaveText('1.');
      await expect(orderedMarkers.nth(1)).toHaveText('5.');
      await expect(orderedMarkers.nth(2)).toHaveText('6.');
    });
  });

  test.describe('ordered list renumbering', () => {
    test('renumbers when first item is deleted', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Verify initial numbering
      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(markers).toHaveCount(3);
      await expect(markers.nth(0)).toHaveText('1.');
      await expect(markers.nth(1)).toHaveText('2.');
      await expect(markers.nth(2)).toHaveText('3.');

      // Click on first item content to focus it
      const firstItem = page.locator(LIST_BLOCK_SELECTOR).first().locator('[contenteditable="true"]');
      await firstItem.click();

      // Select all and delete
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');

      // Wait for items to reduce to 2
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      // Now should only have 2 items, renumbered to 1. and 2.
      const remainingMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(remainingMarkers).toHaveCount(2);
      await expect(remainingMarkers.nth(0)).toHaveText('1.');
      await expect(remainingMarkers.nth(1)).toHaveText('2.');
    });

    test('renumbers when middle item is deleted', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Delete the second item via the API
      await page.evaluate(() => {
        window.blokInstance?.blocks.delete(1);
      });

      // Wait for items to reduce to 2
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      // Now should only have 2 items, renumbered to 1. and 2.
      const remainingMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(remainingMarkers).toHaveCount(2);
      await expect(remainingMarkers.nth(0)).toHaveText('1.');
      await expect(remainingMarkers.nth(1)).toHaveText('2.');
    });

    test('numbers new items correctly when created via Enter', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
        ], 'ordered'),
      });

      // Click on first item and press Enter to create new item
      const firstItem = page.locator(LIST_BLOCK_SELECTOR).first().locator('[contenteditable="true"]');
      await firstItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Wait for the second list block to appear
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      // Now should have 2 items with correct numbering
      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(markers).toHaveCount(2);
      await expect(markers.nth(0)).toHaveText('1.');
      await expect(markers.nth(1)).toHaveText('2.');

      // Type content in the second item (empty items exit list on Enter)
      await page.keyboard.type('Second');

      // Create a third item
      await page.keyboard.press('Enter');

      // Wait for the third list block to appear
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(3);

      const threeMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(threeMarkers).toHaveCount(3);
      await expect(threeMarkers.nth(0)).toHaveText('1.');
      await expect(threeMarkers.nth(1)).toHaveText('2.');
      await expect(threeMarkers.nth(2)).toHaveText('3.');
    });

    test('renumbers correctly when items are reordered via blocks.move()', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Verify initial numbering
      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(markers).toHaveCount(3);
      await expect(markers.nth(0)).toHaveText('1.');
      await expect(markers.nth(1)).toHaveText('2.');
      await expect(markers.nth(2)).toHaveText('3.');

      // Move the third item (index 2) to the first position (index 0)
      await page.evaluate(() => {
        window.blokInstance?.blocks.move(0, 2);
      });

      // Wait for the moved() hook to execute and update markers
      await expect(page.getByText('Third')).toBeVisible();

      // Verify items are now in the new order: Third, First, Second
      const listBlocks = page.locator(LIST_BLOCK_SELECTOR);
      await expect(listBlocks.nth(0).locator('[contenteditable="true"]')).toHaveText('Third');
      await expect(listBlocks.nth(1).locator('[contenteditable="true"]')).toHaveText('First');
      await expect(listBlocks.nth(2).locator('[contenteditable="true"]')).toHaveText('Second');

      // Verify markers are renumbered correctly: 1, 2, 3
      const reorderedMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(reorderedMarkers.nth(0)).toHaveText('1.');
      await expect(reorderedMarkers.nth(1)).toHaveText('2.');
      await expect(reorderedMarkers.nth(2)).toHaveText('3.');
    });

    test('renumbers correctly when new item is inserted at end', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
        ], 'ordered'),
      });

      // Verify initial numbering
      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(markers).toHaveCount(2);
      await expect(markers.nth(0)).toHaveText('1.');
      await expect(markers.nth(1)).toHaveText('2.');

      // Insert a new list item at the end via API (simulates what happens during undo restoration)
      await page.evaluate(() => {
        window.blokInstance?.blocks.insert('list', {
          text: 'Third',
          style: 'ordered',
          depth: 0,
        }, undefined, undefined, false);
      });

      // Wait for items to increase to 3
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(3);

      // Verify all items are numbered correctly: 1, 2, 3
      const afterInsertMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(afterInsertMarkers).toHaveCount(3);
      await expect(afterInsertMarkers.nth(0)).toHaveText('1.');
      await expect(afterInsertMarkers.nth(1)).toHaveText('2.');
      await expect(afterInsertMarkers.nth(2)).toHaveText('3.');
    });

    test('renumbers correctly when new item is inserted in middle', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Verify initial numbering
      const markers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(markers).toHaveCount(2);
      await expect(markers.nth(0)).toHaveText('1.');
      await expect(markers.nth(1)).toHaveText('2.');

      // Insert a new list item in the middle via API (simulates what happens during undo restoration)
      // Insert at index 1 (after First, before Third)
      await page.evaluate(() => {
        window.blokInstance?.blocks.insert('list', {
          text: 'Second',
          style: 'ordered',
          depth: 0,
        }, undefined, 1, false);
      });

      // Wait for items to increase to 3
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(3);

      // Verify all items are numbered correctly: 1, 2, 3
      // The inserted "Second" should be 2, and "Third" should update to 3
      const afterInsertMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(afterInsertMarkers).toHaveCount(3);
      await expect(afterInsertMarkers.nth(0)).toHaveText('1.');
      await expect(afterInsertMarkers.nth(1)).toHaveText('2.');
      await expect(afterInsertMarkers.nth(2)).toHaveText('3.');
    });
  });
});
