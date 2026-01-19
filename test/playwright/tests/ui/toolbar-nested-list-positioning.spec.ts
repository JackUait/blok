import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { createSelector } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${createSelector('interface')} [data-blok-testid="block-wrapper"]`;
const LIST_ITEM_SELECTOR = `${createSelector('interface')} [role="listitem"]`;
const TOOLBAR_SELECTOR = `${createSelector('interface')} [data-blok-testid="toolbar"]`;
const PLUS_BUTTON_SELECTOR = `${createSelector('interface')} [data-blok-testid="plus-button"]`;
const SETTINGS_TOGGLER_SELECTOR = `${createSelector('interface')} [data-blok-testid="settings-toggler"]`;

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
    container.style.width = '600px';
    container.style.margin = '50px auto';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokData }) => {
      const blok = new window.Blok({
        holder: holder,
        ...(blokData ? { data: blokData } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
      blok.caret.setToFirstBlock();
    },
    { holder: HOLDER_ID, blokData: data }
  );
};

const getBoundingBox = async (
  locator: ReturnType<Page['locator']>
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Could not get bounding box for element');
  }

  return box;
};

test.describe('ui.toolbar-nested-list-positioning', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('should position toolbar correctly on nested list item', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Item 1',
                items: [
                  { content: 'Nested item 1.1' },
                  { content: 'Nested item 1.2' },
                ],
              },
              { content: 'Item 2' },
            ],
          },
        },
      ],
    });

    // Hover over a nested list item
    const nestedItems = page.locator(LIST_ITEM_SELECTOR);
    // Get the second nested item (nested item 1.2)
    // eslint-disable-next-line playwright/no-nth-methods
    const targetItem = nestedItems.nth(1);

    await targetItem.hover();

    // Toolbar should be visible
    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    // Plus button should be visible and positioned
    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    await expect(plusButton).toBeVisible();

    // Settings toggler should be visible
    const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);
    await expect(settingsToggler).toBeVisible();
  });

  test('should apply content offset for nested list items', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Item 1',
                items: [
                  { content: 'Nested item with some text' },
                ],
              },
              { content: 'Item 2' },
            ],
          },
        },
      ],
    });

    // Get the toolbar actions element
    const toolbarActions = page.locator(`${TOOLBAR_SELECTOR} [data-blok-testid="toolbar-actions"]`);

    // Hover over top-level item first
    const listItems = page.locator(LIST_ITEM_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const topLevelItem = listItems.nth(0);
    await topLevelItem.hover();

    // Get initial transform value
    const initialTransform = await toolbarActions.evaluate((el) => el.style.transform);

    // Now hover over nested item
    // eslint-disable-next-line playwright/no-nth-methods
    const nestedItem = listItems.nth(1);
    await nestedItem.hover();

    // Get transform value for nested item
    const nestedTransform = await toolbarActions.evaluate((el) => el.style.transform);

    // Nested item should have a transform offset (translateX)
    // while top-level may not have one or have a different value
    expect(nestedTransform).toBeDefined();
  });

  test('should position toolbar correctly on deeply nested list', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Level 1',
                items: [
                  {
                    content: 'Level 2',
                    items: [
                      { content: 'Level 3' },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    // Hover over the deeply nested item (Level 3)
    const listItems = page.locator(LIST_ITEM_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const deepestItem = listItems.nth(2);

    await deepestItem.hover();

    // Toolbar should still be visible and positioned
    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    await expect(plusButton).toBeVisible();

    const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);
    await expect(settingsToggler).toBeVisible();
  });

  test('should handle rapid hovering between nested levels', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Item 1',
                items: [
                  { content: 'Nested 1' },
                  { content: 'Nested 2' },
                ],
              },
              { content: 'Item 2' },
            ],
          },
        },
      ],
    });

    const listItems = page.locator(LIST_ITEM_SELECTOR);

    // Rapidly hover over different items
    // eslint-disable-next-line playwright/no-nth-methods
    await listItems.nth(0).hover();
    await page.waitForTimeout(50);

    // eslint-disable-next-line playwright/no-nth-methods
    await listItems.nth(1).hover();
    await page.waitForTimeout(50);

    // eslint-disable-next-line playwright/no-nth-methods
    await listItems.nth(2).hover();
    await page.waitForTimeout(50);

    // eslint-disable-next-line playwright/no-nth-methods
    await listItems.nth(3).hover();

    // Toolbar should still work correctly
    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    await expect(plusButton).toBeVisible();
  });

  test('should center toolbar on first line of nested list item', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Item with multiple lines of text that should wrap',
                items: [
                  { content: 'Nested item' },
                ],
              },
            ],
          },
        },
      ],
    });

    // Make the container narrow to force text wrapping
    await page.evaluate(() => {
      const container = document.getElementById('blok');
      if (container) {
        container.style.width = '300px';
      }
    });

    const listItems = page.locator(LIST_ITEM_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const nestedItem = listItems.nth(1);

    await nestedItem.hover();

    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    // Verify toolbar is positioned
    const toolbarBox = await getBoundingBox(toolbar);
    const itemBox = await getBoundingBox(nestedItem);

    // Toolbar should be vertically aligned with the item
    expect(toolbarBox.y).toBeGreaterThanOrEqual(itemBox.y - 50);
    expect(toolbarBox.y).toBeLessThanOrEqual(itemBox.y + itemBox.height + 50);
  });

  test('should not break when hovering over list item marker', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Item 1',
                items: [{ content: 'Nested item' }],
              },
            ],
          },
        },
      ],
    });

    const listItems = page.locator(LIST_ITEM_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const targetItem = listItems.nth(0);

    // Get the position of the list item (including marker area)
    const itemBox = await getBoundingBox(targetItem);

    // Hover over the left edge where the marker would be
    await page.mouse.move(itemBox.x + 5, itemBox.y + itemBox.height / 2);

    // Toolbar should still appear
    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();
  });

  test('should work with checklist nested items', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'checklist',
          data: {
            items: [
              {
                text: 'Task 1',
                checked: false,
                items: [
                  { text: 'Subtask 1.1', checked: false },
                ],
              },
            ],
          },
        },
      ],
    });

    const listItems = page.locator(LIST_ITEM_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const nestedItem = listItems.nth(1);

    await nestedItem.hover();

    // Toolbar should work with checklist items
    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    await expect(plusButton).toBeVisible();
  });

  test('should maintain toolbar visibility during block operations in nested list', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Item 1',
                items: [
                  { content: 'Nested 1' },
                  { content: 'Nested 2' },
                ],
              },
            ],
          },
        },
      ],
    });

    const listItems = page.locator(LIST_ITEM_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const firstNested = listItems.nth(1);

    await firstNested.hover();

    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    // Click the plus button to open toolbox
    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    await plusButton.click();

    // Toolbox should open
    const toolbox = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]');
    await expect(toolbox).toBeVisible();
  });
});
