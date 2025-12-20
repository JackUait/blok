/* eslint-disable playwright/no-nth-methods */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

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

    test('tab does not indent beyond parent depth + 1', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item', depth: 1 },
          { text: 'Third item', depth: 1 },
        ]),
      });

      // Click on third item (depth 1)
      const thirdItem = page.locator(LIST_BLOCK_SELECTOR).nth(2).locator('[contenteditable="true"]');

      await thirdItem.click();

      // Press Tab - should not indent because previous item is at depth 1
      // and we can only go to parent depth + 1 (which would be depth 2 only if previous was depth 1)
      // But since third item is already at depth 1 and previous is at depth 1,
      // it can indent to depth 2
      await page.keyboard.press('Tab');

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[2].data.depth).toBe(2);

      // Now try to indent again - should NOT work because previous item is at depth 1
      // and current is now at depth 2 (already deeper than previous)
      await page.keyboard.press('Tab');

      const savedData2 = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // Should still be at depth 2
      expect(savedData2?.blocks[2].data.depth).toBe(2);
    });

    test('tab cannot skip depth levels', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
        ]),
      });

      // Click on second item (depth 0)
      const secondItem = page.locator(LIST_BLOCK_SELECTOR).nth(1).locator('[contenteditable="true"]');

      await secondItem.click();

      // Press Tab once - should indent to depth 1
      await page.keyboard.press('Tab');

      let savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth).toBe(1);

      // Press Tab again - should NOT indent further because first item is at depth 0
      // and we're already at depth 1 (which is parent depth 0 + 1)
      await page.keyboard.press('Tab');

      savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // Should still be at depth 1
      expect(savedData?.blocks[1].data.depth).toBe(1);
    });

    test('deeply nested indentation works with valid parent chain', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'Level 0' },
          { text: 'Level 1', depth: 1 },
          { text: 'Level 2', depth: 2 },
          { text: 'New item', depth: 2 },
        ]),
      });

      // Click on fourth item (depth 2)
      const fourthItem = page.locator(LIST_BLOCK_SELECTOR).nth(3).locator('[contenteditable="true"]');

      await fourthItem.click();

      // Press Tab - should indent to depth 3 because previous item is at depth 2
      await page.keyboard.press('Tab');

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[3].data.depth).toBe(3);
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

      // Delete the first item via the API (same approach as 'renumbers when middle item is deleted')
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.delete(0);
      });

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
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.delete(1);
      });

      // Wait for items to reduce to 2
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      // Now should only have 2 items, renumbered to 1. and 2.
      const remainingMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(remainingMarkers).toHaveCount(2);
      await expect(remainingMarkers.nth(0)).toHaveText('1.');
      await expect(remainingMarkers.nth(1)).toHaveText('2.');
    });

    test('converting middle list item to paragraph creates separate lists', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Click on the second item and set cursor to the start
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

      // Press Backspace at the start - this converts the list item to a paragraph
      await page.keyboard.press('Backspace');

      // Wait for the second item to become a paragraph
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);

      // The paragraph breaks the list, so we now have TWO separate lists:
      // List 1: 1. First
      // Paragraph: Second
      // List 2: 1. Third (starts new numbering because it's a new list)
      const remainingMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(remainingMarkers).toHaveCount(2);
      await expect(remainingMarkers.nth(0)).toHaveText('1.');
      await expect(remainingMarkers.nth(1)).toHaveText('1.'); // New list starts at 1
    });

    test('renumbers when paragraph between list items is deleted via backspace', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Step 1: Convert the second list item to a paragraph by pressing backspace at the start
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

      await page.keyboard.press('Backspace');

      // Now we have: 1. First, <p>Second</p>, 1. Third (two separate lists)
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);

      // Step 2: Focus is already on the paragraph from the backspace action
      // Select all text and delete it
      await page.keyboard.press('Meta+a'); // Select all
      await page.keyboard.press('Backspace'); // Delete selected text

      // Now the paragraph is empty, press backspace again to delete it
      await page.keyboard.press('Backspace');

      // Wait for the paragraph to be deleted, lists should merge
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      // Now should have 2 list items, renumbered to 1. and 2.
      const remainingMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(remainingMarkers).toHaveCount(2);
      await expect(remainingMarkers.nth(0)).toHaveText('1.');
      await expect(remainingMarkers.nth(1)).toHaveText('2.');
    });

    test('renumbers when middle item is deleted via block settings delete button', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Click on the second item to make it the current block
      const secondItem = page.locator(LIST_BLOCK_SELECTOR).nth(1).locator('[contenteditable="true"]');
      await secondItem.click();

      // Delete the current block via API (simulating block settings delete button)
      await page.evaluate(async () => {
        // This is equivalent to clicking the delete button in block settings
        await window.blokInstance?.blocks.delete();
      });

      // Wait for the block to be deleted
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      // Now should only have 2 items, renumbered to 1. and 2.
      const remainingMarkers = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(remainingMarkers).toHaveCount(2);
      await expect(remainingMarkers.nth(0)).toHaveText('1.');
      await expect(remainingMarkers.nth(1)).toHaveText('2.');
    });

    test('renumbers immediately after deletion (no race condition)', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Third' },
        ], 'ordered'),
      });

      // Delete the middle item and immediately check markers
      const result = await page.evaluate(async () => {
        // Delete middle item
        await window.blokInstance?.blocks.delete(1);

        // Immediately check markers before any requestAnimationFrame
        const markers = document.querySelectorAll('[data-blok-tool="list"] [data-list-marker]');
        const immediateMarkers = Array.from(markers).map(m => m.textContent);

        // Wait for requestAnimationFrame
        await new Promise(resolve => requestAnimationFrame(resolve));

        // Check markers after animation frame
        const markersAfterRaf = document.querySelectorAll('[data-blok-tool="list"] [data-list-marker]');
        const rafMarkers = Array.from(markersAfterRaf).map(m => m.textContent);

        // Wait another tick
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check markers after timeout
        const markersAfterTimeout = document.querySelectorAll('[data-blok-tool="list"] [data-list-marker]');
        const timeoutMarkers = Array.from(markersAfterTimeout).map(m => m.textContent);

        return {
          immediateMarkers,
          rafMarkers,
          timeoutMarkers,
        };
      });

      console.log('Immediate markers:', result.immediateMarkers);
      console.log('After RAF markers:', result.rafMarkers);
      console.log('After timeout markers:', result.timeoutMarkers);

      // The final markers should be 1. and 2.
      expect(result.timeoutMarkers).toStrictEqual(['1.', '2.']);
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

  test.describe('list shortcuts with existing content', () => {
    test('converts paragraph with existing text to ordered list when "1. " is typed at start', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: 'Shopping list',
              },
            },
          ],
        },
      });

      // Click at the start of the paragraph and set cursor position programmatically
      // (Home key doesn't work reliably in Firefox/WebKit with contenteditable)
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.evaluate(() => {
        const para = document.querySelector('[data-blok-tool="paragraph"]');
        if (para) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.setStart(para, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      // Type the ordered list shortcut
      await page.keyboard.type('1. ');

      // The paragraph should be converted to a list
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);

      // The list item should contain the original text
      const listContent = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
      await expect(listContent).toHaveText('Shopping list');

      // Verify it's an ordered list
      const marker = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(marker).toHaveText('1.');
    });

    test('converts paragraph with existing text to unordered list when "- " is typed at start', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: 'Buy groceries',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.evaluate(() => {
        const para = document.querySelector('[data-blok-tool="paragraph"]');
        if (para) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.setStart(para, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      await page.keyboard.type('- ');

      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);

      const listContent = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
      await expect(listContent).toHaveText('Buy groceries');

      // Verify it's an unordered list (bullet marker)
      const marker = page.locator(`${LIST_BLOCK_SELECTOR} [data-list-marker]`);
      await expect(marker).toHaveText('•');
    });

    test('converts paragraph with existing text to checklist when "[] " is typed at start', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: 'Task to complete',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.evaluate(() => {
        const para = document.querySelector('[data-blok-tool="paragraph"]');
        if (para) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.setStart(para, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      await page.keyboard.type('[] ');

      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);

      const listContent = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
      await expect(listContent).toHaveText('Task to complete');

      // Verify it's a checklist (checkbox present)
      const checkbox = page.locator(LIST_BLOCK_SELECTOR).getByRole('checkbox');
      await expect(checkbox).toHaveCount(1);
      await expect(checkbox).not.toBeChecked();
    });

    test('preserves HTML formatting when converting to list', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        inlineToolbar: true,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: '<b>Bold</b> and <i>italic</i> text',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.evaluate(() => {
        const para = document.querySelector('[data-blok-tool="paragraph"]');
        if (para) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.setStart(para, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      await page.keyboard.type('- ');

      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(1);

      // Verify HTML is preserved (editor may normalize <b> to <strong>)
      const listContent = page.locator(`${LIST_BLOCK_SELECTOR} [contenteditable="true"]`);
      const html = await listContent.innerHTML();
      expect(html).toMatch(/<(b|strong)>Bold<\/(b|strong)>/);
      expect(html).toContain('<i>italic</i>');
    });

    test('does not convert when shortcut is typed in the middle of text', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: 'Buy milk',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      // Type "1. " in the middle (after "Buy ")
      await page.keyboard.type('1. ');

      // Should remain a paragraph, not convert to list
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(0);
    });
  });

  test.describe('drag and drop depth validation', () => {
    test('nested item moved to first position becomes depth 0', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Nested item', depth: 1 },
        ]),
      });

      // Move nested item (index 1) to first position (index 0)
      await page.evaluate(() => {
        window.blokInstance?.blocks.move(0, 1);
      });

      // Wait for DOM update after move
      await expect(page.getByText('Nested item')).toBeVisible();

      // Verify depth is adjusted to 0
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
    });

    test('deeply nested item moved to first position becomes depth 0', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'Level 0' },
          { text: 'Level 1', depth: 1 },
          { text: 'Level 2', depth: 2 },
        ]),
      });

      // Move depth-2 item to first position
      await page.evaluate(() => {
        window.blokInstance?.blocks.move(0, 2);
      });

      // Wait for DOM update after move
      await expect(page.getByText('Level 2')).toBeVisible();

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // First item should be depth 0
      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
    });

    test('item depth is capped to previousItem.depth + 1 after move', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second' },
          { text: 'Deep item', depth: 2 },
        ]),
      });

      // Move the deep item (index 2, depth 2) to position 1 (after First which is depth 0)
      await page.evaluate(() => {
        window.blokInstance?.blocks.move(1, 2);
      });

      // Wait for DOM update after move
      await expect(page.getByText('Deep item')).toBeVisible();

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // Deep item should be capped at depth 1 (previous item depth 0 + 1)
      expect(savedData?.blocks[1].data.depth).toBe(1);
    });

    test('nested item preserves valid depth after move', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First' },
          { text: 'Second', depth: 1 },
          { text: 'Third', depth: 1 },
        ]),
      });

      // Move Third (index 2, depth 1) to position 1 (after First which is depth 0)
      // Depth 1 is valid because previous item (First) is depth 0, and 0+1=1
      await page.evaluate(() => {
        window.blokInstance?.blocks.move(1, 2);
      });

      // Wait for DOM update after move
      await expect(page.getByText('Third')).toBeVisible();

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // Depth should remain 1 since it's still valid
      expect(savedData?.blocks[1].data.depth).toBe(1);
    });

    test('moved block shows selection highlight after depth adjustment', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'Level 0' },
          { text: 'Level 1', depth: 1 },
          { text: 'Level 2', depth: 2 },
        ]),
      });

      // Simulate the drag-drop flow:
      // 1. BlockManager.move() triggers the moved() hook which adjusts depth
      // 2. After move returns, DragManager selects the moved block
      // The bug was that adjustDepthTo() called api.blocks.update() asynchronously,
      // which would replace the block instance AFTER selection was applied,
      // causing the selection to be lost.
      const result = await page.evaluate(async () => {
        // Move depth-2 item to first position (triggers depth adjustment)
        window.blokInstance?.blocks.move(0, 2);

        // Get the block at the new position (what DragManager does)
        const movedBlock = window.blokInstance?.blocks.getBlockByIndex(0);

        if (!movedBlock) {
          return { error: 'Block not found' };
        }

        // Get the block's holder element and set selection attribute directly
        // (simulating what BlockSelection.selectBlock does)
        const blockHolder = document.querySelector(
          `[data-blok-interface=blok] [data-blok-tool="list"]:first-child`
        )?.closest('[data-blok-testid="block-wrapper"]');

        if (blockHolder) {
          blockHolder.setAttribute('data-blok-selected', 'true');
        }

        // Wait a tick to allow any async operations to complete
        // (this would have caused the bug before the fix)
        await new Promise(resolve => setTimeout(resolve, 50));

        // Check if selection is still present after async operations
        const isStillSelected = blockHolder?.getAttribute('data-blok-selected') === 'true';

        return {
          isStillSelected,
          blockId: movedBlock.id,
        };
      });

      expect(result).not.toHaveProperty('error');
      expect(result.isStillSelected).toBe(true);

      // Verify depth was also adjusted correctly
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
    });
  });

  test.describe('multi-select indent/outdent', () => {
    /**
     * Helper to select multiple blocks by their indices using Shift+ArrowDown.
     * Clicks on the first block, then uses Shift+Down to extend selection.
     */
    const selectBlocksRange = async (page: Page, startIndex: number, endIndex: number): Promise<void> => {
      const startBlock = page.locator(LIST_BLOCK_SELECTOR).nth(startIndex).locator('[contenteditable="true"]');
      await startBlock.click();

      // Use Cmd+A twice to select the block, then Shift+Down to extend
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Meta+a');

      const stepsDown = endIndex - startIndex;
      for (let i = 0; i < stepsDown; i++) {
        await page.keyboard.press('Shift+ArrowDown');
      }
    };

    test('tab indents all selected list items when all are at valid depth', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ]),
      });

      // Select second and third items
      await selectBlocksRange(page, 1, 2);

      // Verify blocks are selected
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(2)).toHaveAttribute('data-blok-selected', 'true');

      // Press Tab to indent
      await page.keyboard.press('Tab');

      // Verify both items are now at depth 1
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth).toBe(1);
      expect(savedData?.blocks[2].data.depth).toBe(1);
    });

    test('shift+tab outdents all selected list items', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item', depth: 1 },
          { text: 'Third item', depth: 1 },
        ]),
      });

      // Select second and third items (both at depth 1)
      await selectBlocksRange(page, 1, 2);

      // Press Shift+Tab to outdent
      await page.keyboard.press('Shift+Tab');

      // Verify both items are now at depth 0
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth ?? 0).toBe(0);
      expect(savedData?.blocks[2].data.depth ?? 0).toBe(0);
    });

    test('tab does nothing when any selected item cannot be indented', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ]),
      });

      // Select first and second items (first cannot be indented - no previous list item)
      await selectBlocksRange(page, 0, 1);

      // Press Tab - should do nothing because first item can't indent
      await page.keyboard.press('Tab');

      // Verify neither item was indented
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
      expect(savedData?.blocks[1].data.depth ?? 0).toBe(0);
    });

    test('shift+tab does nothing when any selected item is at depth 0', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item', depth: 1 },
          { text: 'Third item' },  // depth 0
        ]),
      });

      // Select second and third items (third is at depth 0)
      await selectBlocksRange(page, 1, 2);

      // Press Shift+Tab - should do nothing because third item can't outdent
      await page.keyboard.press('Shift+Tab');

      // Verify neither item changed
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth).toBe(1);
      expect(savedData?.blocks[2].data.depth ?? 0).toBe(0);
    });

    test('tab does nothing when selection includes non-list blocks', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'List item', style: 'unordered' } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Paragraph' } },
          ],
        },
      });

      // Select both blocks (mixed types)
      const listItem = page.locator(LIST_BLOCK_SELECTOR).first().locator('[contenteditable="true"]');
      await listItem.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Shift+ArrowDown');

      // Press Tab - should do nothing because selection includes paragraph
      await page.keyboard.press('Tab');

      // Verify list item was not indented
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
    });

    test('selection is preserved after indent', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ]),
      });

      // Select second and third items
      await selectBlocksRange(page, 1, 2);

      // Press Tab to indent
      await page.keyboard.press('Tab');

      // Verify blocks are still selected
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(2)).toHaveAttribute('data-blok-selected', 'true');
    });
  });
});
