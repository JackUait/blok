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
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
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
  const { data = null, tools = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<
          Record<string, { class: unknown } & Record<string, unknown>>
        >((accumulator, { name, className, config }) => {
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

          return {
            ...accumulator,
            [name]: {
              class: toolClass,
              ...config,
            },
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
    }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  list: {
    className: 'Blok.List',
  },
};

const createListData = (items: string[], style: 'unordered' | 'ordered' | 'checklist' = 'unordered'): OutputData => ({
  blocks: [
    {
      type: 'list',
      data: {
        style,
        items: items.map(content => ({ content, checked: false })),
      },
    },
  ],
});

test.describe('list tool', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders unordered list with items', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['First item', 'Second item', 'Third item']),
      });

      const list = page.locator(LIST_BLOCK_SELECTOR);

      await expect(list).toBeVisible();
      await expect(page.getByText('First item')).toBeVisible();
      await expect(page.getByText('Second item')).toBeVisible();
      await expect(page.getByText('Third item')).toBeVisible();
    });

    test('renders ordered list', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['First', 'Second'], 'ordered'),
      });

      const list = page.locator(LIST_BLOCK_SELECTOR);

      await expect(list).toBeVisible();
      await expect(list).toHaveAttribute('data-list-style', 'ordered');
    });

    test('renders checklist', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['Task one', 'Task two'], 'checklist'),
      });

      const list = page.locator(LIST_BLOCK_SELECTOR);

      await expect(list).toBeVisible();
      await expect(list).toHaveAttribute('data-list-style', 'checklist');
    });
  });

  test.describe('editing', () => {
    test('allows editing list item text', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['Original text']),
      });

      const listItem = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="0"]`);

      await listItem.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' - Updated');

      await expect(listItem).toHaveText('Original text - Updated');
    });

    test('creates new item on Enter in non-empty item', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['First item']),
      });

      const firstItem = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="0"]`);

      await firstItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Should have two items now
      const items = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index]`);

      await expect(items).toHaveCount(2);
    });
  });

  test.describe('double Enter to exit list', () => {
    test('first Enter creates empty item, second Enter exits list and creates paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['First item']),
      });

      const firstItem = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="0"]`);

      await firstItem.click();
      await page.keyboard.press('End');

      // First Enter - creates a new empty item
      await page.keyboard.press('Enter');

      const items = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index]`);

      await expect(items).toHaveCount(2);

      // Second Enter on empty item - should exit list and create paragraph
      await page.keyboard.press('Enter');

      // Should still have the list with one item
      const list = page.locator(LIST_BLOCK_SELECTOR);

      await expect(list).toBeVisible();

      const remainingItems = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index]`);

      await expect(remainingItems).toHaveCount(1);

      // Should have a new paragraph block after the list
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
    });

    test('double Enter on single empty item replaces list with paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['']),
      });

      const emptyItem = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="0"]`);

      await emptyItem.click();

      // Enter on empty item should exit list
      await page.keyboard.press('Enter');

      // List should be gone, replaced by paragraph
      const list = page.locator(LIST_BLOCK_SELECTOR);

      await expect(list).toHaveCount(0);

      // At least one paragraph should exist (editor may create default empty block)
      const paragraphs = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await expect(paragraphs).toHaveCount(1);
    });

    test('double Enter in middle of list preserves items above', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['First item', 'Second item', 'Third item']),
      });

      // Click on second item
      const secondItem = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="1"]`);

      await secondItem.click();
      await page.keyboard.press('End');

      // First Enter - creates new empty item after second
      await page.keyboard.press('Enter');

      // Second Enter - exits list
      await page.keyboard.press('Enter');

      // List should still exist with items
      const list = page.locator(LIST_BLOCK_SELECTOR);

      await expect(list).toBeVisible();

      // Paragraph should be created
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
    });

    test('works with ordered list', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['Item one'], 'ordered'),
      });

      const item = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="0"]`);

      await item.click();
      await page.keyboard.press('End');

      // First Enter
      await page.keyboard.press('Enter');

      // Second Enter
      await page.keyboard.press('Enter');

      // Should have paragraph after list
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
    });

    test('works with checklist', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['Task'], 'checklist'),
      });

      // For checklist, the contenteditable is inside a wrapper div
      const checklistItem = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="0"] [contenteditable="true"]`);

      await checklistItem.click();
      await page.keyboard.press('End');

      // First Enter
      await page.keyboard.press('Enter');

      // Second Enter
      await page.keyboard.press('Enter');

      // Should have paragraph after list
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
    });
  });

  test.describe('data saving', () => {
    test('saves list data correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['First', 'Second']),
      });

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('list');
      expect(savedData?.blocks[0].data.items).toHaveLength(2);
      expect(savedData?.blocks[0].data.items[0].content).toBe('First');
      expect(savedData?.blocks[0].data.items[1].content).toBe('Second');
    });

    test('saves after double Enter correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListData(['Keep this item']),
      });

      const item = page.locator(`${LIST_BLOCK_SELECTOR} [data-item-index="0"]`);

      await item.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // Should have list block and paragraph block
      expect(savedData?.blocks).toHaveLength(2);
      expect(savedData?.blocks[0].type).toBe('list');
      expect(savedData?.blocks[0].data.items).toHaveLength(1);
      expect(savedData?.blocks[0].data.items[0].content).toBe('Keep this item');
      expect(savedData?.blocks[1].type).toBe('paragraph');
    });
  });
});
